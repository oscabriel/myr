/**
 * seed: puts both fictional example projects on a platform, ready for the
 * demo, and changes nothing when run again.
 *
 *   bun scripts/seed.ts --world node
 *   bunx varlock run --path apps/platform/ -- bun scripts/seed.ts --stage dev-<user>
 *
 * `--world node` serves the Node world on this machine for the run
 * (`apps/platform/test/serve-world.ts`). `--stage <s>` seeds a deployed
 * stage at `--url`, or at the workers.dev origin bootstrap recorded, with
 * tokens only from the env: `SESSION_TOKENS` (token to handle, as the
 * platform's own; `--tokens-env` names another) and `OPERATOR_TOKEN`
 * (`--operator-env`). `--stage demo` also needs `--yes`: the user records
 * on it (H7). `--only <project>` seeds one example; `--json`
 * prints the versioned envelope.
 *
 * `--only <example> --as <name>` seeds a fresh copy of that example under
 * another project name (`--only burrow --as burrow-swarm-2`), so a live run
 * can take a family nobody has touched while the example itself stays fresh
 * for the recording. A name some project has is refused. A copy on a stage
 * is written to the throwaway ledger (`infra/created.ts`, by `seed`) as soon
 * as the platform has made it, with its repo and each layer's repo.
 *
 * Each project is made, and main's first commit pushed, as the operator;
 * each ask is opened as the decider the project's config names, red first
 * on the platform's own Checker; then each layer the example keeps under
 * `layers/` (datekit's maintainers layer) is pushed by that decider to its
 * repo in the private namespace. It prints one line per step, one per
 * project, and a summary. The seed's core lives in `lib/seed.ts`.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Envelope } from "@repo/protocol/envelope";
import { Handle, ProjectName } from "@repo/protocol/ids";
import {
  Array,
  Console,
  DateTime,
  Effect,
  Option,
  Path,
  Schema,
  Stdio,
} from "effect";

import { recordCreated } from "../infra/created.ts";
import type { Created } from "../infra/created.ts";
import {
  flagValue,
  platformOrigin,
  recordedSubdomain,
  resources,
  Stage,
  stageOf,
  subdomainFile,
} from "../infra/stages.ts";
import {
  MAIN_REF,
  planSeed,
  ready,
  renameSeedPlan,
  runSeedWith,
  SeedFailed,
  seeded,
  SeedStep,
  stageTarget,
  worldTarget,
} from "./lib/seed.ts";
import type { SeededProject, SeedPlan } from "./lib/seed.ts";

/** The examples the seed knows, in the order it seeds them. */
export const EXAMPLES = ["examples/datekit", "examples/burrow"] as const;

/** Where a seed goes: the Node world on this machine, or a deployed stage. */
export const SeedWhere = Schema.TaggedUnion({
  Stage: {
    stage: Stage,
    /** The env vars that hold the stage's tokens. */
    tokens: Schema.Struct({ operator: Schema.String, sessions: Schema.String }),
    url: Schema.optionalKey(Schema.String),
  },
  World: {},
});

export type SeedWhere = typeof SeedWhere.Type;

/** What `bun scripts/seed.ts` was asked to do. */
export interface SeedOptions {
  readonly where: SeedWhere;
  /** The one project to seed, when not both. */
  readonly only?: string;
  /** The name to seed `only`'s example under, as a fresh copy (`--as`). */
  readonly as?: ProjectName;
  /** Print the versioned envelope instead of lines. */
  readonly json: boolean;
}

/** The flags the command takes; any other is a typo, refused. */
const FLAGS = new Set([
  "--as",
  "--json",
  "--only",
  "--operator-env",
  "--stage",
  "--tokens-env",
  "--url",
  "--world",
  "--yes",
]);

const USAGE =
  "bun scripts/seed.ts --world node | --stage <dev-…|demo> [--url <origin>] [--tokens-env SESSION_TOKENS] [--operator-env OPERATOR_TOKEN] [--only <project> [--as <copy>]] [--json] [--yes]";

const failed = (reason: string) => new SeedFailed({ reason });

/** The stage `--stage` names, its tokens' env vars, and where it lives if `--url` says. */
const stageFrom = (argv: readonly string[]) =>
  Effect.gen(function* () {
    // infra's own reading of `--stage`, and its words when it names none.
    const stage = yield* stageOf(argv).pipe(
      Effect.mapError(({ message }) => failed(message))
    );

    if (stage === "demo" && !argv.includes("--yes")) {
      return yield* failed(
        "--stage demo is the stage the user records on (H7): seed it only between takes, with --yes"
      );
    }

    const tokens = {
      operator: Option.getOrElse(
        flagValue(argv, "--operator-env"),
        () => "OPERATOR_TOKEN"
      ),
      sessions: Option.getOrElse(
        flagValue(argv, "--tokens-env"),
        () => "SESSION_TOKENS"
      ),
    };

    return Option.match(flagValue(argv, "--url"), {
      onNone: () => SeedWhere.cases.Stage.make({ stage, tokens }),
      onSome: (url) =>
        SeedWhere.cases.Stage.make({
          stage,
          tokens,
          url: url.replace(/\/+$/u, ""),
        }),
    });
  });

/**
 * `--as`'s name, for a copy of the example `--only` names: a project name,
 * and not the example's own.
 */
const copyName = (name: string, only: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isNone(only)) {
      return yield* failed(
        `--as ${name} names one copy: add --only <example> to say which example it copies`
      );
    }

    const copy = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() =>
        failed(
          `--as ${name} is no project name: use lowercase words joined by dashes`
        )
      )
    );

    return copy === only.value
      ? yield* failed(
          `--as ${name} is the example's own name: a copy needs a name of its own`
        )
      : copy;
  });

/** The command's flags, read; a seed of `demo` needs `--yes` (H7: the user records on it). */
export const optionsOf = (
  argv: readonly string[]
): Effect.Effect<SeedOptions, SeedFailed> =>
  Effect.gen(function* () {
    const strange = argv.filter(
      (arg) => arg.startsWith("--") && !FLAGS.has(arg.split("=")[0] ?? arg)
    );

    if (Array.isReadonlyArrayNonEmpty(strange)) {
      return yield* failed(`unknown flag ${strange.join(", ")}: ${USAGE}`);
    }

    const world = flagValue(argv, "--world");
    const raw = flagValue(argv, "--stage");

    if (Option.isSome(world) && Option.isSome(raw)) {
      return yield* failed(`--world and --stage: name only one. ${USAGE}`);
    }

    if (Option.isSome(world) && world.value !== "node") {
      return yield* failed(
        `--world ${world.value}: the seed knows only --world node`
      );
    }

    const where = Option.isSome(world)
      ? SeedWhere.cases.World.make({})
      : yield* Option.match(raw, {
          onNone: () =>
            Effect.fail(failed(`name --world node or --stage <s>: ${USAGE}`)),
          onSome: () => stageFrom(argv),
        });

    const json = argv.includes("--json");
    const only = flagValue(argv, "--only");

    const as = yield* Option.match(flagValue(argv, "--as"), {
      onNone: () => Effect.succeedNone,
      onSome: (name) => Effect.asSome(copyName(name, only)),
    });

    return {
      json,
      where,
      ...Option.match(only, {
        onNone: () => ({}),
        onSome: (one) => ({ only: one }),
      }),
      ...Option.match(as, {
        onNone: () => ({}),
        onSome: (copy) => ({ as: copy }),
      }),
    };
  });

/**
 * Writes a copy on `stage` to the throwaway ledger, by the seed: the
 * project, its repo in the public namespace, and each layer's repo in the
 * private one, which the platform makes when main lands declaring it.
 */
export const recordCopy = (stage: Stage, plan: SeedPlan, at: DateTime.Utc) => {
  const { layers, projects } = resources(stage);
  const by = "seed";

  const entries: readonly Created[] = [
    { at, by, kind: "project", name: plan.project, stage },
    { at, by, kind: "repo", name: plan.project, namespace: projects, stage },
    ...plan.layers.map(({ repo }): Created => ({
      at,
      by,
      kind: "repo",
      name: repo,
      namespace: layers,
      stage,
    })),
  ];

  return Effect.forEach(entries, recordCreated, { discard: true }).pipe(
    Effect.mapError(({ message }) => failed(`the throwaway ledger: ${message}`))
  );
};

/** What `--json` prints for one seeded project. */
const SeededSummary = Schema.Struct({
  asks: Schema.Array(Schema.String),
  decider: Handle,
  main: Schema.optionalKey(Schema.String),
  project: ProjectName,
  ratchets: Schema.Array(Schema.String),
});

type SeededSummary = typeof SeededSummary.Type;

/** What `--json` prints: the versioned envelope over the steps and each project. */
export const SeedEnvelope = Envelope(
  Schema.Struct({
    projects: Schema.Array(SeededSummary),
    steps: Schema.Array(SeedStep),
  })
);

const printEnvelope = (envelope: typeof SeedEnvelope.Type) =>
  Effect.flatMap(
    Schema.encodeEffect(Schema.fromJsonString(SeedEnvelope))(envelope),
    Console.log
  ).pipe(Effect.orDie);

/** Where a stage's platform lives: `--url`, or the workers.dev subdomain bootstrap recorded. */
const stageOrigin = (where: (typeof SeedWhere.cases.Stage)["Type"]) =>
  Effect.gen(function* () {
    if (where.url !== undefined) {
      return where.url;
    }

    const subdomain = yield* recordedSubdomain.pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.mapError(() =>
        failed(
          `no --url, and ${subdomainFile} doesn't record the account's workers.dev subdomain: run bun run bootstrap -- --stage ${where.stage} first`
        )
      )
    );

    return platformOrigin(where.stage, subdomain);
  });

/** Where the seed goes, said for a person, and the target there. */
const targetFor = (where: SeedWhere, plans: readonly SeedPlan[]) =>
  SeedWhere.match(where, {
    Stage: (stage) =>
      Effect.map(stageOrigin(stage), (origin) => ({
        label: `${stage.stage} (${origin})`,
        target: stageTarget(origin, stage.tokens),
      })),
    World: () =>
      Effect.succeed({
        label: "the Node world",
        target: worldTarget(plans.map(({ decider }) => decider)),
      }),
  });

/** One step as the command prints it: `OpenAsk datekit/format-ordinal: done`. */
export const stepLine = ({ _tag, result, target }: SeedStep) =>
  `${_tag} ${target}: ${result}`;

/** One project as the summary prints it. */
const projectLine = ({
  asks,
  decider,
  main,
  project,
  ratchets,
}: SeededSummary) =>
  [
    `${project}: main at ${main?.slice(0, 12) ?? "nothing"}`,
    `${asks.length} open asks`,
    `decided by ${decider}`,
    ...ratchets.map((name) => `ratchet ${name}`),
  ].join(", ");

/** What a plan's project holds now, for the summary. */
const summaryOf = (
  plan: SeedPlan,
  held: SeededProject | undefined
): SeededSummary => {
  const summary = {
    asks: (held?.asks ?? []).map(({ ask }) => String(ask)),
    decider: plan.decider,
    project: plan.project,
    ratchets: plan.ratchets,
  };

  const landed = held?.refs.find(([ref]) => ref === MAIN_REF)?.[1];

  return landed === undefined ? summary : { ...summary, main: landed };
};

/**
 * `bun scripts/seed.ts …`: plans each example, seeds it on the world or the
 * stage, then prints one line per step, one per project and a summary (or,
 * with `--json`, the versioned envelope). A refusal under `--json` prints
 * the envelope with it, and the command still fails.
 */
export const main = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const options = yield* optionsOf(argv);
    const path = yield* Path.Path;

    const folders = EXAMPLES.filter(
      (folder) =>
        options.only === undefined || path.basename(folder) === options.only
    );

    if (!Array.isReadonlyArrayNonEmpty(folders)) {
      return yield* failed(
        `--only ${options.only ?? ""} names no example: ${EXAMPLES.map((folder) => path.basename(folder)).join(", ")}`
      );
    }

    const plans = yield* Effect.forEach(folders, (folder) =>
      Effect.map(planSeed(folder), (plan): SeedPlan =>
        options.as === undefined ? plan : renameSeedPlan(plan, options.as)
      )
    );

    const { label, target } = yield* targetFor(options.where, plans);

    const say = (line: string) =>
      options.json ? Effect.void : Console.log(line);

    // A copy on a stage goes to the throwaway ledger once it is made.
    const made = (plan: SeedPlan) =>
      SeedWhere.match(options.where, {
        Stage: ({ stage }) =>
          plan.copyOf === undefined
            ? Effect.void
            : Effect.flatMap(DateTime.now, (at) => recordCopy(stage, plan, at)),
        World: () => Effect.void,
      });

    yield* say(
      `seed: ${plans
        .map(({ copyOf, project }) =>
          copyOf === undefined ? project : `${project} (a copy of ${copyOf})`
        )
        .join(", ")} on ${label}`
    );

    const run = Effect.gen(function* () {
      yield* ready(plans);

      const steps = yield* Effect.forEach(plans, (plan) =>
        Effect.tap(runSeedWith(plan, made), (done) =>
          Effect.forEach(done, (each) => say(stepLine(each)), {
            discard: true,
          })
        )
      ).pipe(Effect.map((each) => each.flat()));

      const held = yield* seeded(plans);
      const projects = plans.map((plan, at) => summaryOf(plan, held[at]));

      yield* Effect.forEach(projects, (each) => say(projectLine(each)), {
        discard: true,
      });

      const done = steps.filter(({ result }) => result === "done").length;

      const count =
        projects.length === 1 ? "1 project" : `${projects.length} projects`;

      yield* say(
        `seeded ${count} on ${label}: ${steps.length} steps, ${done} done, ${steps.length - done} already`
      );

      if (options.json) {
        yield* printEnvelope({
          command: "seed",
          data: { projects, steps },
          ok: true,
          v: 1,
        });
      }
    });

    return yield* run.pipe(
      Effect.provide(target),
      Effect.tapError(({ refusals }) =>
        options.json && refusals !== undefined
          ? printEnvelope({ command: "seed", ok: false, refusals, v: 1 })
          : Effect.void
      )
    );
  });

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* main(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
