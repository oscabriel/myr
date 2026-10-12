import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Envelope } from "@repo/protocol/envelope";
import { Handle, keyOf, ProjectName } from "@repo/protocol/ids";
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
  worldOperator,
  worldTarget,
} from "./lib/seed.ts";
import type { SeededProject, SeedPlan } from "./lib/seed.ts";

export const EXAMPLES = ["examples/datekit", "examples/burrow"] as const;

export const SeedWhere = Schema.TaggedUnion({
  Stage: {
    stage: Stage,
    tokens: Schema.Struct({ operator: Schema.String, sessions: Schema.String }),
    url: Schema.optionalKey(Schema.String),
  },
  World: {},
});

export type SeedWhere = typeof SeedWhere.Type;

export interface SeedOptions {
  readonly where: SeedWhere;
  readonly only?: string;
  readonly as?: ProjectName;
  readonly json: boolean;
}

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

const stageFrom = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const stage = yield* stageOf(argv).pipe(
      Effect.mapError(({ message }) => failed(message))
    );

    if (stage === "prod") {
      return yield* failed(
        "--stage prod is the real platform: the examples are fictional, so seed them on a dev stage or demo"
      );
    }

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

const copyName = (name: string, only: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isNone(only)) {
      return yield* failed(
        `--as ${name} names one copy: add --only <example> to say which example it copies`
      );
    }

    const spelled = name.includes("/") ? name : `${worldOperator}/${name}`;

    const copy = yield* Schema.decodeEffect(ProjectName)(spelled).pipe(
      Effect.mapError(() =>
        failed(
          `--as ${name} is no project name: use <owner>/<name>, or a name in lowercase words joined by dashes for ${worldOperator}'s`
        )
      )
    );

    const example = Schema.decodeOption(ProjectName)(only.value);

    return Option.contains(example, copy)
      ? yield* failed(
          `--as ${name} is the example's own name: a copy needs a name of its own`
        )
      : copy;
  });

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

export const recordCopy = (stage: Stage, plan: SeedPlan, at: DateTime.Utc) => {
  const { layers, projects } = resources(stage);
  const by = "seed";
  // The project's key is both its Durable Object's id and its repo's name.
  const key = keyOf(plan.project);

  const entries: readonly Created[] = [
    { at, by, kind: "project", name: key, stage },
    { at, by, kind: "repo", name: key, namespace: projects, stage },
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

const SeededSummary = Schema.Struct({
  asks: Schema.Array(Schema.String),
  decider: Handle,
  main: Schema.optionalKey(Schema.String),
  project: ProjectName,
  ratchets: Schema.Array(Schema.String),
});

type SeededSummary = typeof SeededSummary.Type;

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

export const stepLine = ({ _tag, result, target }: SeedStep) =>
  `${_tag} ${target}: ${result}`;

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
