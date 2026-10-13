// The one table of stages and the resources each owns, each named by its job
// plus the stage, never the brand. `packages/config/test/bootstrap.test.ts`
// holds every Worker's `wrangler.jsonc` env blocks to it.
import { Brand } from "@repo/brand";
import { Effect, FileSystem, Option, Path, Schema } from "effect";

export const Stage = Schema.Union([
  Schema.TemplateLiteral([
    "dev-",
    Schema.String.check(Schema.isPattern(/^[a-z0-9]+$/u)),
  ]),
  Schema.Literal("demo"),
  Schema.Literal("prod"),
]);

export type Stage = typeof Stage.Type;

// Each has an `env` block in every Worker's `wrangler.jsonc`; add a stage to both.
export const stages = [
  "dev-oscabriel",
  "demo",
  "prod",
] as const satisfies readonly Stage[];

// The stages people see: no script makes a throwaway project or seeds a
// fictional one on them without being told to.
export const publicStages: ReadonlySet<string> = new Set<Stage>([
  "demo",
  "prod",
]);

export interface Hosts {
  readonly platform: string;
  readonly web: string;
  // More Custom Domains on the web's Worker, each answered with a 301 to `web`.
  readonly webAliases: readonly string[];
}

// A stage served on the brand's own domain, as Workers Custom Domains. The
// names live here, not in `wrangler.jsonc`, so the brand stays in
// `packages/brand`: `infra/deploy.ts` hands them to Wrangler as `--domain`
// and as the URL vars, and such a stage turns its `workers.dev` route off.
// What such a stage's `wrangler.jsonc` holds in each URL var: `.invalid`
// never resolves, so a deploy that skipped `--var` fails where it shows.
export const URL_FROM_DEPLOY = "https://from-infra-deploy.invalid";

export const customHosts = (stage: Stage): Option.Option<Hosts> =>
  stage === "prod"
    ? Option.some({
        platform: `git.${Brand.domain}`,
        web: Brand.domain,
        webAliases: [`www.${Brand.domain}`],
      })
    : Option.none();

// The job of the Analytics Engine dataset each answer's outcome is written
// to, named `<job>_<stage>` (`resources(stage).outcomes`). Analytics Engine
// makes a dataset on its first write, so bootstrap makes none. The refusal
// alert (`alerts.ts`) reads it by this name, so the binding that writes it
// names the same.
export const OUTCOMES_JOB = "outcomes";

export interface Resources {
  readonly platform: string;
  readonly sandbox: string;
  readonly web: string;
  readonly projects: string;
  // Private: every project's layer repos.
  readonly layers: string;
  readonly frontPage: string;
  readonly oauth: string;
  readonly evidence: string;
  readonly releases: string;
  readonly codeCache: string;
  // Workers Analytics Engine's domain metrics: made by its first write, so
  // bootstrap makes none, and named with `_`, since SQL reads it as a table.
  readonly metrics: string;
  readonly answer: string;
  readonly onPush: string;
  readonly outcomes: string;
}

export const resources = (stage: Stage): Resources => ({
  answer: `answer-${stage}`,
  codeCache: `code-cache-${stage}`,
  evidence: `evidence-${stage}`,
  frontPage: `front-page-${stage}`,
  layers: `layers-${stage}`,
  metrics: `metrics_${stage.replaceAll("-", "_")}`,
  oauth: `oauth-${stage}`,
  onPush: `on-push-${stage}`,
  outcomes: `${OUTCOMES_JOB}_${stage}`,
  platform: `platform-${stage}`,
  projects: `projects-${stage}`,
  releases: `releases-${stage}`,
  sandbox: `sandbox-${stage}`,
  web: `web-${stage}`,
});

const decodeStage = Schema.decodeUnknownOption(Stage);

export const declaredStage = (raw: string): Option.Option<Stage> =>
  Option.filter(decodeStage(raw), (stage) =>
    stages.some((declared) => declared === stage)
  );

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

// `runMain` prints only a failure's tag and message, so each infra failure's
// message says what to do. None carries a secret's value.

export class NoStage extends Schema.TaggedError<NoStage>()("NoStage", {}) {
  override readonly message = `no --stage: name one of ${stages.join(", ")}`;
}

export class UnknownStage extends Schema.TaggedError<UnknownStage>()(
  "UnknownStage",
  { stage: Schema.String }
) {
  override get message() {
    return `--stage ${this.stage} is not a stage infra/stages.ts declares (${stages.join(", ")})`;
  }
}

export const stageOf = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const raw = yield* Effect.fromOption(flagValue(argv, "--stage")).pipe(
      Effect.mapError(() => new NoStage())
    );

    return yield* Effect.fromOption(declaredStage(raw)).pipe(
      Effect.mapError(() => new UnknownStage({ stage: raw }))
    );
  });

export const repoRoot = Effect.flatMap(Path.Path, (path) =>
  path.fromFileUrl(new URL("..", import.meta.url))
).pipe(Effect.orDie);

export const subdomainFile = "infra/workers-dev.json";

export const WorkersDev = Schema.Struct({ subdomain: Schema.NonEmptyString });

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

export const platformOrigin = (stage: Stage, subdomain: string) =>
  Option.match(customHosts(stage), {
    onNone: () =>
      `https://${resources(stage).platform}.${subdomain}.workers.dev`,
    onSome: ({ platform }) => `https://${platform}`,
  });

export const webOrigin = (stage: Stage, subdomain: string) =>
  Option.match(customHosts(stage), {
    onNone: () => `https://${resources(stage).web}.${subdomain}.workers.dev`,
    onSome: ({ web }) => `https://${web}`,
  });
