/**
 * The import run: reads the flags, asks the platform what it lists, imports
 * the rest of the examples one at a time, prints each one's heads and tags,
 * records each new import on a stage in the ledger as kept, and with
 * `--tags` backfills the tags of an import that came without them.
 *
 * The platform and the backfill are services (`ImportTarget`,
 * `TagBackfill`), so a test runs the whole run over fakes; `live.ts` holds
 * the real ones.
 */
import { ProjectName } from "@repo/protocol/ids";
import { ProjectExists } from "@repo/protocol/refusal";
import {
  Array,
  Console,
  Context,
  DateTime,
  Duration,
  Effect,
  Option,
  Ref,
  Schedule,
  Schema,
} from "effect";
import type { FileSystem, Layer, PlatformError } from "effect";

import {
  isRecorded,
  ledgerPath,
  readLedger,
  recordCreated,
} from "../../../infra/created.ts";
import type { Created } from "../../../infra/created.ts";
import { flagValue, resources, Stage, stageOf } from "../../../infra/stages.ts";
import { examples, planImports } from "./plan.ts";
import type { ImportExample } from "./plan.ts";

/** Why the run stopped, said for a person; never a token. */
export class ImportExamplesFailed extends Schema.TaggedError<ImportExamplesFailed>()(
  "ImportExamplesFailed",
  { reason: Schema.String }
) {
  override get message() {
    return this.reason;
  }
}

const failed = (reason: string) => new ImportExamplesFailed({ reason });

/** Where the imports go: a dev stage, or the Node world on this machine. */
export const ImportWhere = Schema.TaggedUnion({
  Stage: { stage: Stage, url: Schema.optionalKey(Schema.String) },
  World: {},
});

export type ImportWhere = typeof ImportWhere.Type;

/** What `bun scripts/import-examples.ts` was asked to do. */
export interface ImportOptions {
  readonly where: ImportWhere;
  /** The one example to import, when not all. */
  readonly only: Option.Option<ProjectName>;
  /** Print the plan, import and record nothing. */
  readonly dryRun: boolean;
  /** Backfill the tags of an import that has none. */
  readonly tags: boolean;
}

/** The platform the imports go to, as the operator. */
export class ImportTarget extends Context.Service<
  ImportTarget,
  {
    /** Where it is, said for a person: `dev-oscabriel (https://…)`. */
    readonly label: string;
    readonly listProjects: Effect.Effect<
      ReadonlySet<ProjectName>,
      ImportExamplesFailed
    >;
    /** One `initProject` importing `example`: main's first landed SHA. */
    readonly initProject: (
      example: ImportExample
    ) => Effect.Effect<{ readonly landed?: string }, ImportExamplesFailed>;
    /** How many branches and tags the project's repo serves, anonymously. */
    readonly counts: (
      project: ProjectName
    ) => Effect.Effect<
      { readonly heads: number; readonly tags: number },
      ImportExamplesFailed
    >;
  }
>()("scripts/ImportTarget") {}

/**
 * Pushes an import's tags from its source to its canonical repo: the one
 * write that skips the gateway, tags only, by the operator. How many tags
 * it pushed.
 */
export class TagBackfill extends Context.Service<
  TagBackfill,
  {
    readonly backfill: (
      example: ImportExample
    ) => Effect.Effect<number, ImportExamplesFailed>;
  }
>()("scripts/TagBackfill") {}

const isProjectExists = Schema.is(ProjectExists);

/**
 * One import's `initProject`, asked again 30 s apart, up to three more
 * times, while it got no answer (`answered` false): a large import can
 * outlast the edge's request timeout, and the platform adopts the repo the
 * first call left. A refusal is never asked again. `ProjectExists` after a
 * call that got no answer is that call's project, made after its answer
 * was lost: this run's import, its landed SHA not known here.
 */
export const initUntilAnswered = <A extends { readonly landed?: string }, E>(
  call: Effect.Effect<A, E>,
  answered: (error: E) => boolean
): Effect.Effect<{ readonly landed?: string }, E> =>
  Effect.gen(function* () {
    const unanswered = yield* Ref.make(false);

    return yield* call.pipe(
      Effect.catch((error) =>
        Effect.flatMap(Ref.get(unanswered), (earlier) =>
          earlier && isProjectExists(error)
            ? Effect.succeed({})
            : Effect.fail(error)
        )
      ),
      Effect.tapError((error) =>
        answered(error) ? Effect.void : Ref.set(unanswered, true)
      ),
      Effect.retry({
        schedule: Schedule.spaced(Duration.seconds(30)),
        times: 3,
        while: (error) => !answered(error),
      })
    );
  });

const USAGE =
  "bun scripts/import-examples.ts --world node | --stage <dev-…> [--url <origin>] [--only <project>] [--tags] [--dry-run]";

/** The flags the command takes; any other is a typo, refused. */
const FLAGS = new Set([
  "--dry-run",
  "--only",
  "--stage",
  "--tags",
  "--url",
  "--world",
]);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/** The command's flags, read; `--stage demo` is refused before anything runs. */
export const optionsOf = (
  argv: readonly string[]
): Effect.Effect<ImportOptions, ImportExamplesFailed> =>
  Effect.gen(function* () {
    const strange = argv.filter(
      (arg) => arg.startsWith("--") && !FLAGS.has(arg.split("=")[0] ?? arg)
    );

    if (Array.isReadonlyArrayNonEmpty(strange)) {
      return yield* failed(`unknown flag ${strange.join(", ")}: ${USAGE}`);
    }

    const world = flagValue(argv, "--world");
    const raw = flagValue(argv, "--stage");

    if (Option.isSome(world) === Option.isSome(raw)) {
      return yield* failed(`name one of --world node or --stage <s>: ${USAGE}`);
    }

    if (Option.isSome(world) && world.value !== "node") {
      return yield* failed(
        `--world ${world.value}: the imports know only --world node`
      );
    }

    if (Option.contains(raw, "demo")) {
      return yield* failed(
        "--stage demo is the recording stage: the imports go on a dev stage only"
      );
    }

    const tags = argv.includes("--tags");

    if (tags && Option.isSome(world)) {
      return yield* failed(
        "--tags backfills through Artifacts' REST API, so on a stage only"
      );
    }

    const where = Option.isSome(world)
      ? ImportWhere.cases.World.make({})
      : yield* stageOf(argv).pipe(
          Effect.mapError(({ message }) => failed(message)),
          Effect.map((stage) =>
            Option.match(flagValue(argv, "--url"), {
              onNone: () => ImportWhere.cases.Stage.make({ stage }),
              onSome: (url) =>
                ImportWhere.cases.Stage.make({
                  stage,
                  url: url.replace(/\/+$/u, ""),
                }),
            })
          )
        );

    const only = yield* Option.match(flagValue(argv, "--only"), {
      onNone: () => Effect.succeedNone,
      onSome: (named) =>
        Option.match(
          Option.filter(decodeProject(named), (project) =>
            examples.some((one) => one.project === project)
          ),
          {
            onNone: () =>
              Effect.fail(
                failed(
                  `--only ${named} names no example: ${examples.map(({ project }) => project).join(", ")}`
                )
              ),
            onSome: Effect.succeedSome,
          }
        ),
    });

    return { dryRun: argv.includes("--dry-run"), only, tags, where };
  });

/** The ledger's line for an import's repo, in the stage's public namespace. */
const repoLine = (
  stage: Stage,
  project: ProjectName,
  at: DateTime.Utc
): Created => ({
  at,
  by: "import",
  kind: "repo",
  name: project,
  namespace: resources(stage).projects,
  stage,
});

/** The ledger's two lines for a new import on `stage`: its project, and its repo. */
const importLines = (
  stage: Stage,
  project: ProjectName,
  at: DateTime.Utc
): readonly Created[] => [
  { at, by: "import", kind: "project", name: project, stage },
  repoLine(stage, project, at),
];

const ledgerFailed = ({ message }: PlatformError.PlatformError) =>
  failed(`the ledger (${ledgerPath}): ${message}`);

/** Appends `entries` to the ledger. */
const record = (entries: readonly Created[]) =>
  Effect.forEach(entries, recordCreated, { discard: true }).pipe(
    Effect.mapError(ledgerFailed)
  );

/** The stage the run records on, if it runs on one. */
const stageOfWhere = (where: ImportWhere) =>
  ImportWhere.match(where, {
    Stage: ({ stage }) => Option.some(stage),
    World: () => Option.none<Stage>(),
  });

/**
 * `--tags` on one import: its tags pushed from its source when its repo
 * serves none, the ledger told, and a line printed.
 */
const backfillOne = (
  example: ImportExample,
  tagCount: number,
  stage: Option.Option<Stage>
) =>
  Effect.gen(function* () {
    if (tagCount > 0) {
      return;
    }

    const pushed = yield* TagBackfill.use((tags) => tags.backfill(example));
    const at = yield* DateTime.now;

    yield* Option.match(stage, {
      onNone: () => Effect.void,
      onSome: (on) =>
        record([
          { ...repoLine(on, example.project, at), note: "tags backfilled" },
        ]),
    });

    yield* Console.log(
      `  ${example.project}: ${pushed} tags backfilled from ${example.url}`
    );
  });

/** The run itself, over a target and a backfill. */
const run = (options: ImportOptions) =>
  Effect.gen(function* () {
    const target = yield* ImportTarget;
    const listed = yield* target.listProjects;
    const stage = stageOfWhere(options.where);

    const asked = planImports(examples, new Set(), options.only);
    const plan = planImports(examples, listed, options.only);
    const skipped = asked.filter(({ project }) => listed.has(project));

    yield* Console.log(
      `import-examples on ${target.label}: ${plan.length} to import, ${skipped.length} listed already`
    );
    yield* Effect.forEach(
      skipped,
      ({ project }) => Console.log(`  skip ${project}: listed already`),
      { discard: true }
    );

    if (options.dryRun) {
      yield* Effect.forEach(
        plan,
        ({ branch, project, url }) =>
          Console.log(`  would import ${project} from ${url} (${branch})`),
        { discard: true }
      );
      yield* Console.log("dry run: nothing imported, nothing recorded");

      return;
    }

    // One at a time: each import is a whole history copied into Artifacts.
    yield* Effect.forEach(
      plan,
      (example) =>
        Effect.gen(function* () {
          const made = yield* target.initProject(example);
          const at = yield* DateTime.now;

          // Recorded as soon as the platform made it, before anything else
          // can fail.
          yield* Option.match(stage, {
            onNone: () => Effect.void,
            onSome: (on) => record(importLines(on, example.project, at)),
          });

          const { heads, tags } = yield* target.counts(example.project);

          yield* Console.log(
            `imported ${example.project} (${example.kind}, ${example.branch}): main at ${made.landed?.slice(0, 12) ?? "a SHA an earlier unanswered call landed"}, ${heads} heads, ${tags} tags`
          );

          if (options.tags) {
            yield* backfillOne(example, tags, stage);
          }
        }),
      { discard: true }
    );

    // An import from an earlier run that this run skipped is backfilled
    // too, if the ledger holds it as an import of this stage.
    if (options.tags && Option.isSome(stage)) {
      const ledger = yield* readLedger.pipe(
        Effect.mapError((error) =>
          failed(`the ledger (${ledgerPath}): ${error.message}`)
        )
      );

      const imported = ledger.filter(({ by }) => by === "import");

      const earlier = skipped.filter(({ project }) =>
        isRecorded(imported, {
          kind: "project",
          name: project,
          stage: stage.value,
        })
      );

      yield* Effect.forEach(
        earlier,
        (example) =>
          Effect.flatMap(target.counts(example.project), ({ tags }) =>
            backfillOne(example, tags, stage)
          ),
        { discard: true }
      );
    }

    yield* Console.log(
      Option.isSome(stage)
        ? `imported ${plan.length} of ${plan.length}, each recorded in ${ledgerPath} as a kept import`
        : `imported ${plan.length} of ${plan.length} into the Node world (not recorded: the ledger is for stages)`
    );
  });

/**
 * `bun scripts/import-examples.ts …`: reads the flags (refusing `demo`
 * before anything is built or called), then runs over the target and
 * backfill `layersOf` gives for them.
 */
export const importExamples = <E, R>(
  argv: readonly string[],
  layersOf: (
    options: ImportOptions
  ) => Layer.Layer<ImportTarget | TagBackfill, E, R>
): Effect.Effect<void, ImportExamplesFailed | E, R | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const options = yield* optionsOf(argv);

    return yield* run(options).pipe(Effect.provide(layersOf(options)));
  });
