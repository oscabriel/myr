// Usage: bun run deploy -- --stage <stage>
// Runs verify, deploys sandbox, platform and web, checks the push trigger, then
// smoke. Refused while `infra/.recording` exists, before any flag is read.
// `STAGE_SECRETS_FILE` passes only the items `apps/platform/.env.schema`
// declares, to the platform step alone; no value is ever printed.
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
import { notRecording } from "./recording.ts";
import type { RecordingInProgress } from "./recording.ts";
import {
  platformOrigin,
  repoRoot,
  stageOf,
  subdomainFile,
  WorkersDev,
} from "./stages.ts";
import type { NoStage, Stage, UnknownStage } from "./stages.ts";

export { RecordingInProgress } from "./recording.ts";

export { NoStage, UnknownStage } from "./stages.ts";

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", {
  exitCode: Schema.Int,
  step: Schema.String,
}) {
  override get message() {
    return `${this.step} exited ${this.exitCode}, so nothing after it ran`;
  }
}

export class SecretsFileUnreadable extends Schema.TaggedError<SecretsFileUnreadable>()(
  "SecretsFileUnreadable",
  { file: Schema.String }
) {
  override get message() {
    return `STAGE_SECRETS_FILE names ${this.file}, which can't be read`;
  }
}

interface Step {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}

const bin = (app: string, name: string) => `${app}/node_modules/.bin/${name}`;

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
  // The Vite plugin takes the stage from CLOUDFLARE_ENV and writes its deploy
  // config under `dist/`, so Wrangler gets no --env. NODE_ENV stops a shell's
  // own value from making a development build, whose `#backend` is the dev world.
  ...(options.web
    ? [
        {
          args: ["run", "build"],
          command: "bun",
          cwd: "apps/web",
          env: { CLOUDFLARE_ENV: stage, NODE_ENV: "production" },
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

const platformSecrets = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const file = yield* Config.option(Config.String("STAGE_SECRETS_FILE")).pipe(
      Effect.orDie
    );

    if (Option.isNone(file)) {
      return {};
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

// Mirrors `apps/platform/src/auth/pages.ts`: infra imports no app.
const GOOGLE_CALLBACK = "/oauth/google/callback";

const decodeWorkersDev = Schema.decodeUnknownEffect(
  Schema.fromJsonString(WorkersDev)
);

const googleRedirectLine = (root: string, stage: Stage) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const recorded = yield* fs
      .readFileString(path.join(root, subdomainFile))
      .pipe(Effect.flatMap(decodeWorkersDev), Effect.option);

    return Option.match(recorded, {
      onNone: () =>
        `deploy ${stage}: to offer Google sign-in, run bun run bootstrap -- --stage ${stage} for the platform's origin, then register <origin>${GOOGLE_CALLBACK} as the Google client's redirect URI (H4)`,
      onSome: ({ subdomain }) =>
        `deploy ${stage}: to offer Google sign-in, register ${platformOrigin(stage, subdomain)}${GOOGLE_CALLBACK} as the Google client's redirect URI (H4)`,
    });
  });

export const deploy = (
  argv: readonly string[]
): Effect.Effect<
  void,
  | RecordingInProgress
  | NoStage
  | UnknownStage
  | StepFailed
  | SecretsFileUnreadable,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    yield* notRecording;

    const stage = yield* stageOf(argv);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;

    const web = yield* fs
      .exists(path.join(root, "apps/web/wrangler.jsonc"))
      .pipe(Effect.orDie);

    const platformEnv = yield* platformSecrets(root);

    yield* Effect.forEach(
      stepsOf(stage, { platformEnv, web }),
      (step) => runStep(root, stage, step),
      { discard: true }
    );

    yield* Console.log(`deploy ${stage}: deployed, and smoke passed.`);
    yield* Console.log(yield* googleRedirectLine(root, stage));
  });

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* deploy(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
