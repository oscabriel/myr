/**
 * deploy: `bun run deploy -- --stage dev-<user>|demo`. The one way a stage
 * is deployed (AGENTS.md principle 11, ADR 0002):
 *
 * 1. `bun run verify`: a red gate stops everything after it;
 * 2. `sandbox`, with Wrangler: the platform's `SANDBOX` binding names it;
 * 3. `platform`, with `varlock-wrangler`, which resolves
 *    `apps/platform/.env.schema` and syncs its secrets with the Worker;
 * 4. `web`, built for the stage and deployed with Wrangler, once `apps/web`
 *    exists (W5);
 * 5. the push-event trigger, read back and compared (`bootstrap.ts
 *    --check-triggers`, with the infra token from `varlock run`);
 * 6. `scripts/smoke.ts` against the live stage.
 *
 * Without `--stage`, or with a stage `stages.ts` doesn't declare, it refuses
 * before it spawns anything. It takes no other flag: verify always runs.
 * Every command runs with `WRANGLER_SEND_METRICS=false`; Wrangler deploys
 * with its own login, never the read-mostly infra token.
 *
 * `STAGE_SECRETS_FILE` names a dotenv file outside the repo whose values the
 * platform's deploy carries as its environment, which varlock reads before
 * any `.env` file (spec §8.3 O1: the dev stage's generated secrets). Only the
 * items `apps/platform/.env.schema` declares are passed, to that one step,
 * and no value is ever printed. With `--stage demo` it refuses the file
 * before it spawns anything: demo's secrets are a person's to set (H5).
 *
 * Each step runs with its own folder's `node_modules/.bin` first on `PATH`,
 * since `varlock-wrangler` starts `wrangler` by name.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  Config,
  ConfigProvider,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  Stdio,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { schemaItems } from "./env-schema.ts";
import { repoRoot, stageOf } from "./stages.ts";
import type { NoStage, Stage, UnknownStage } from "./stages.ts";

export { NoStage, UnknownStage } from "./stages.ts";

/** A step exited non-zero; nothing after it ran. */
export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", {
  exitCode: Schema.Int,
  step: Schema.String,
}) {
  override get message() {
    return `${this.step} exited ${this.exitCode}, so nothing after it ran`;
  }
}

/** `STAGE_SECRETS_FILE` names a file that can't be read. */
export class SecretsFileUnreadable extends Schema.TaggedError<SecretsFileUnreadable>()(
  "SecretsFileUnreadable",
  { file: Schema.String }
) {
  override get message() {
    return `STAGE_SECRETS_FILE names ${this.file}, which can't be read`;
  }
}

/**
 * `STAGE_SECRETS_FILE` was given for `demo`: generated secrets are the dev
 * stage's alone, and `demo`'s are a person's to set (spec §8.3 O1, H5).
 */
export class SecretsFileNotForStage extends Schema.TaggedError<SecretsFileNotForStage>()(
  "SecretsFileNotForStage",
  { stage: Schema.String }
) {
  override get message() {
    return `STAGE_SECRETS_FILE is for dev stages only: set ${this.stage}'s secrets with varlock (infra/stages.md)`;
  }
}

/** One command of the deploy, run from `cwd` (relative to the repo root). */
interface Step {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Wrangler's own bin in an app, so each app deploys with its pinned version. */
const bin = (app: string, name: string) => `${app}/node_modules/.bin/${name}`;

/** Every step a deploy of `stage` runs, in order. */
const stepsOf = (
  stage: Stage,
  options: {
    readonly web: boolean;
    readonly platformEnv: Readonly<Record<string, string>>;
  }
): readonly Step[] => [
  { args: ["run", "verify"], command: "bun", cwd: "", name: "verify" },
  {
    args: ["deploy", "--env", stage],
    command: bin("apps/sandbox", "wrangler"),
    cwd: "apps/sandbox",
    name: "sandbox",
  },
  {
    args: ["deploy", "--env", stage],
    command: bin("apps/platform", "varlock-wrangler"),
    cwd: "apps/platform",
    env: options.platformEnv,
    name: "platform",
  },
  // ASSUMPTION for W5 (501, 599): the web app builds with the Vite plugin,
  // which picks the stage from CLOUDFLARE_ENV, and Wrangler deploys the
  // build's own config for that stage.
  ...(options.web
    ? [
        {
          args: ["run", "build"],
          command: "bun",
          cwd: "apps/web",
          env: { CLOUDFLARE_ENV: stage },
          name: "web build",
        },
        {
          args: ["deploy", "--env", stage],
          command: bin("apps/web", "wrangler"),
          cwd: "apps/web",
          name: "web",
        },
      ]
    : []),
  {
    args: ["run", "bootstrap", "--stage", stage, "--check-triggers"],
    command: "bun",
    cwd: "",
    name: "triggers",
  },
  {
    args: ["scripts/smoke.ts", "--stage", stage],
    command: "bun",
    cwd: "",
    name: "smoke",
  },
];

/**
 * The values `STAGE_SECRETS_FILE` holds for the items the platform's
 * `.env.schema` declares: none when it isn't set. Only a dev stage takes one.
 */
const platformSecrets = (root: string, stage: Stage) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const file = yield* Config.option(Config.String("STAGE_SECRETS_FILE")).pipe(
      Effect.orDie
    );

    if (Option.isNone(file)) {
      return {};
    }

    if (stage === "demo") {
      return yield* new SecretsFileNotForStage({ stage });
    }

    const contents = yield* fs
      .readFileString(file.value)
      .pipe(
        Effect.mapError(() => new SecretsFileUnreadable({ file: file.value }))
      );

    const schema = yield* fs
      .readFileString(path.join(root, "apps/platform/.env.schema"))
      .pipe(Effect.orDie);

    const provider = ConfigProvider.fromDotEnvContents(contents);

    const values = yield* Effect.forEach(schemaItems(schema), ({ name }) =>
      Config.option(Config.String(name))
        .parse(provider)
        .pipe(
          Effect.orDie,
          Effect.map(Option.map((value) => [name, value] as const))
        )
    );

    return Object.fromEntries(values.flatMap(Option.toArray));
  });

/** Runs one step from the repo root, failing when it exits non-zero. */
const runStep = (root: string, stage: Stage, step: Step) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const shown = [path.basename(step.command), ...step.args].join(" ");

    const inherited = yield* Config.option(Config.String("PATH")).pipe(
      Effect.orDie
    );

    // varlock-wrangler starts `wrangler` by name, and `bun run deploy` puts
    // only the root's bins on PATH, where no wrangler lives: the step's own
    // folder's bins come first, as a package runner would put them.
    const searched = [
      path.join(root, step.cwd, "node_modules/.bin"),
      ...Option.toArray(inherited),
    ].join(":");

    yield* Console.log(`deploy ${stage}: ${step.name}: ${shown}`);

    const exitCode = yield* spawner
      .exitCode(
        ChildProcess.make(
          step.command === "bun" ? "bun" : path.join(root, step.command),
          step.args,
          {
            cwd: path.join(root, step.cwd),
            env: {
              ...step.env,
              PATH: searched,
              WRANGLER_SEND_METRICS: "false",
            },
            extendEnv: true,
            stderr: "inherit",
            stdout: "inherit",
          }
        )
      )
      .pipe(Effect.orDie);

    return yield* exitCode === 0
      ? Effect.void
      : Effect.fail(new StepFailed({ exitCode, step: step.name }));
  });

/** Deploys the stage `argv`'s `--stage` names, then smoke-tests it. */
export const deploy = (
  argv: readonly string[]
): Effect.Effect<
  void,
  | NoStage
  | UnknownStage
  | StepFailed
  | SecretsFileUnreadable
  | SecretsFileNotForStage,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const stage = yield* stageOf(argv);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;

    const web = yield* fs
      .exists(path.join(root, "apps/web/wrangler.jsonc"))
      .pipe(Effect.orDie);

    const platformEnv = yield* platformSecrets(root, stage);

    yield* Effect.forEach(
      stepsOf(stage, { platformEnv, web }),
      (step) => runStep(root, stage, step),
      { discard: true }
    );

    yield* Console.log(`deploy ${stage}: deployed, and smoke passed.`);
  });

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* deploy(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
