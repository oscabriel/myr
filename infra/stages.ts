/**
 * The one table of stages and of the Cloudflare resources each one owns.
 * A stage is `dev-<user>`, one person's iteration, or `demo`,
 * the recording and the submission; there is no `prod` before the deadline.
 * Each resource is a job's name plus the stage, never the brand
 * (AGENTS.md principle 5).
 *
 * `bootstrap.ts`, `deploy.ts` and `scripts/smoke.ts` read stages and names
 * only from here, and `packages/config/test/bootstrap.test.ts` holds every
 * `env` block of the platform's and the sandbox's `wrangler.jsonc` to it.
 */
import { Effect, FileSystem, Option, Path, Schema } from "effect";

/** A stage's shape: `dev-` and a lowercase user, or `demo`. */
export const Stage = Schema.Union([
  Schema.TemplateLiteral([
    "dev-",
    Schema.String.check(Schema.isPattern(/^[a-z0-9]+$/u)),
  ]),
  Schema.Literal("demo"),
]);

export type Stage = typeof Stage.Type;

/**
 * The stages this repo declares: each has an `env` block in every Worker's
 * `wrangler.jsonc`. A new person's stage joins here and there together.
 */
export const stages = [
  "dev-oscabriel",
  "demo",
] as const satisfies readonly Stage[];

/** Every resource one stage owns, by job. */
export interface Resources {
  /** The platform Worker. */
  readonly platform: string;
  /** The sandbox Worker: the Checker and the Lander. */
  readonly sandbox: string;
  /** The web Worker. */
  readonly web: string;
  /** The public Artifacts namespace. */
  readonly projects: string;
  /** The private Artifacts namespace: every project's layer repos. */
  readonly layers: string;
  /** The D1 database behind the front page. */
  readonly frontPage: string;
  /** The KV namespace that holds OAuth grants. */
  readonly oauth: string;
  /** The R2 bucket that keeps lane logs. */
  readonly evidence: string;
  /** The R2 bucket the CLI's releases are downloaded from (`/install.sh`, `/releases/*`). */
  readonly releases: string;
  /** The Workflow that merges, checks and lands an answer. */
  readonly answer: string;
  /** The Workflow that hears every push to the public namespace. */
  readonly onPush: string;
}

/** Each resource's name at `stage`. */
export const resources = (stage: Stage): Resources => ({
  answer: `answer-${stage}`,
  evidence: `evidence-${stage}`,
  frontPage: `front-page-${stage}`,
  layers: `layers-${stage}`,
  oauth: `oauth-${stage}`,
  onPush: `on-push-${stage}`,
  platform: `platform-${stage}`,
  projects: `projects-${stage}`,
  releases: `releases-${stage}`,
  sandbox: `sandbox-${stage}`,
  web: `web-${stage}`,
});

const decodeStage = Schema.decodeUnknownOption(Stage);

/** `raw` as a stage this repo declares, if it is one. */
export const declaredStage = (raw: string): Option.Option<Stage> =>
  Option.filter(decodeStage(raw), (stage) =>
    stages.some((declared) => declared === stage)
  );

/**
 * The value `flag` names in `argv`, as `--flag value` or `--flag=value`, if
 * it has one.
 */
export const flagValue = (
  argv: readonly string[],
  flag: string
): Option.Option<string> => {
  const joined = argv.find((arg) => arg.startsWith(`${flag}=`));

  if (joined !== undefined) {
    return Option.some(joined.slice(flag.length + 1));
  }

  const at = argv.indexOf(flag);

  return Option.filter(
    Option.fromNullishOr(at === -1 ? undefined : argv[at + 1]),
    (value) => !value.startsWith("--")
  );
};

/**
 * Each infra command's failures say, as their message, what went wrong and
 * what to do: `runMain` prints a failure's tag and message, and nothing of
 * its fields. They are a script's failures, not the protocol's refusals, and
 * never carry a secret's value.
 */

/** No `--stage` was given: nothing touches a stage by default. */
export class NoStage extends Schema.TaggedError<NoStage>()("NoStage", {}) {
  override readonly message = `no --stage: name one of ${stages.join(", ")}`;
}

/** `--stage` names no stage this table declares. */
export class UnknownStage extends Schema.TaggedError<UnknownStage>()(
  "UnknownStage",
  { stage: Schema.String }
) {
  override get message() {
    return `--stage ${this.stage} is not a stage infra/stages.ts declares (${stages.join(", ")})`;
  }
}

/** The stage `argv`'s `--stage` names, if this table declares it. */
export const stageOf = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const raw = yield* Effect.fromOption(flagValue(argv, "--stage")).pipe(
      Effect.mapError(() => new NoStage())
    );

    return yield* Effect.fromOption(declaredStage(raw)).pipe(
      Effect.mapError(() => new UnknownStage({ stage: raw }))
    );
  });

/** The repo root, which every infra script's paths are relative to. */
export const repoRoot = Effect.flatMap(Path.Path, (path) =>
  path.fromFileUrl(new URL("..", import.meta.url))
).pipe(Effect.orDie);

/**
 * Where bootstrap records the account's workers.dev subdomain, relative to
 * the repo root. It is absent until bootstrap's first run.
 */
export const subdomainFile = "infra/workers-dev.json";

/** `subdomainFile`'s contents. */
export const WorkersDev = Schema.Struct({ subdomain: Schema.NonEmptyString });

/**
 * The account's workers.dev subdomain, as bootstrap recorded it in
 * `subdomainFile`; none before bootstrap's first run, or when the file does
 * not decode. Seed, smoke and the swarm each read it when no `--url` is
 * given, and say in their own words what to run.
 */
export const recordedSubdomain = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs
    .readFileString(path.join(yield* repoRoot, subdomainFile))
    .pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(WorkersDev))),
      Effect.map(({ subdomain }) => subdomain),
      Effect.option
    );
});

/** The platform's public origin at `stage`, on the account's workers.dev. */
export const platformOrigin = (stage: Stage, subdomain: string) =>
  `https://${resources(stage).platform}.${subdomain}.workers.dev`;

/** The web's public origin at `stage`, on the account's workers.dev. */
export const webOrigin = (stage: Stage, subdomain: string) =>
  `https://${resources(stage).web}.${subdomain}.workers.dev`;
