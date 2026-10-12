import { ProjectName } from "@repo/protocol/ids";
import type { ProjectKey } from "@repo/protocol/ids";
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

export class ImportExamplesFailed extends Schema.TaggedError<ImportExamplesFailed>()(
  "ImportExamplesFailed",
  { reason: Schema.String }
) {
  override get message() {
    return this.reason;
  }
}

const failed = (reason: string) => new ImportExamplesFailed({ reason });

export const ImportWhere = Schema.TaggedUnion({
  Stage: { stage: Stage, url: Schema.optionalKey(Schema.String) },
  World: {},
});

export type ImportWhere = typeof ImportWhere.Type;

export interface ImportOptions {
  readonly where: ImportWhere;
  readonly only: Option.Option<ProjectName>;
  readonly dryRun: boolean;
  readonly tags: boolean;
  readonly sources: boolean;
  readonly warm: boolean;
  readonly web: Option.Option<string>;
}

export class ImportTarget extends Context.Service<
  ImportTarget,
  {
    readonly label: string;
    readonly listProjects: Effect.Effect<
      ReadonlySet<ProjectName>,
      ImportExamplesFailed
    >;
    readonly initProject: (
      example: ImportExample
    ) => Effect.Effect<{ readonly landed?: string }, ImportExamplesFailed>;
    readonly counts: (
      project: ProjectName
    ) => Effect.Effect<
      { readonly heads: number; readonly tags: number },
      ImportExamplesFailed
    >;
  }
>()("scripts/ImportTarget") {}

/** The one write that skips the gateway: tags only, by the operator. */
export class TagBackfill extends Context.Service<
  TagBackfill,
  {
    readonly backfill: (
      example: ImportExample
    ) => Effect.Effect<number, ImportExamplesFailed>;
  }
>()("scripts/TagBackfill") {}

export interface WarmRead {
  readonly path: string;
  readonly ok: boolean;
  readonly said: string;
}

// A failed read is reported, never a failure: warming is a courtesy.
export class Warmer extends Context.Service<
  Warmer,
  {
    readonly warm: (project: ProjectName) => Effect.Effect<readonly WarmRead[]>;
  }
>()("scripts/Warmer") {}

const isProjectExists = Schema.is(ProjectExists);

/**
 * A large import can outlast the edge's request timeout; the platform adopts
 * the repo the first call left, so a call with no answer is asked again. A
 * `ProjectExists` after such a call is that call's own project.
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
  "bun scripts/import-examples.ts --world node | --stage <stage> [--url <origin>] [--web <origin>] [--only <project>] [--tags] [--sources] [--warm] [--dry-run]";

const FLAGS = new Set([
  "--dry-run",
  "--only",
  "--sources",
  "--stage",
  "--tags",
  "--url",
  "--warm",
  "--web",
  "--world",
]);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

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
            examples.some((one) => one.name === project)
          ),
          {
            onNone: () =>
              Effect.fail(
                failed(
                  `--only ${named} names no example: ${examples.map(({ name }) => name).join(", ")}`
                )
              ),
            onSome: Effect.succeedSome,
          }
        ),
    });

    return {
      dryRun: argv.includes("--dry-run"),
      only,
      sources: argv.includes("--sources"),
      tags,
      warm: argv.includes("--warm"),
      web: Option.map(flagValue(argv, "--web"), (web) =>
        web.replace(/\/+$/u, "")
      ),
      where,
    };
  });

const repoLine = (
  stage: Stage,
  key: ProjectKey,
  at: DateTime.Utc
): Created => ({
  at,
  by: "import",
  kind: "repo",
  name: key,
  namespace: resources(stage).projects,
  stage,
});

const importLines = (
  stage: Stage,
  key: ProjectKey,
  at: DateTime.Utc
): readonly Created[] => [
  { at, by: "import", kind: "project", name: key, stage },
  repoLine(stage, key, at),
];

const ledgerFailed = ({ message }: PlatformError.PlatformError) =>
  failed(`the ledger (${ledgerPath}): ${message}`);

const record = (entries: readonly Created[]) =>
  Effect.forEach(entries, recordCreated, { discard: true }).pipe(
    Effect.mapError(ledgerFailed)
  );

const stageOfWhere = (where: ImportWhere) =>
  ImportWhere.match(where, {
    Stage: ({ stage }) => Option.some(stage),
    World: () => Option.none<Stage>(),
  });

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
        record([{ ...repoLine(on, example.key, at), note: "tags backfilled" }]),
    });

    yield* Console.log(
      `  ${example.name}: ${pushed} tags backfilled from ${example.url}`
    );
  });

const warmOne = (project: ProjectName) =>
  Effect.gen(function* () {
    const reads = yield* Warmer.use((warmer) => warmer.warm(project));
    const failures = reads.filter(({ ok }) => !ok);

    yield* Console.log(
      Array.isReadonlyArrayNonEmpty(reads)
        ? [
            `  warmed ${project}: ${reads.length - failures.length} of ${reads.length} pages read`,
            ...failures.map(({ path, said }) => `${path}: ${said}`),
          ].join("; ")
        : `  warm ${project}: no web to read through`
    );
  });

// An import the ledger records but the platform does not list is still never imported again.
const recordedImports = (stage: Option.Option<Stage>) =>
  Effect.gen(function* () {
    if (Option.isNone(stage)) {
      return new Set<ProjectName>();
    }

    const ledger = yield* readLedger.pipe(
      Effect.mapError((error) =>
        failed(`the ledger (${ledgerPath}): ${error.message}`)
      )
    );

    const imported = ledger.filter(({ by }) => by === "import");

    return new Set(
      examples.flatMap(({ key, name }) =>
        isRecorded(imported, {
          kind: "project",
          name: key,
          stage: stage.value,
        })
          ? [name]
          : []
      )
    );
  });

// A repeated `initProject` with the same source makes the platform keep that source.
const sourceOne = (example: ImportExample) =>
  Effect.gen(function* () {
    const target = yield* ImportTarget;

    const outcome = yield* target.initProject(example).pipe(
      Effect.map(() => `source kept: ${example.url} (${example.branch})`),
      Effect.catch(({ reason }) => Effect.succeed(`source not kept: ${reason}`))
    );

    yield* Console.log(`  ${example.name}: ${outcome}`);
  });

const run = (options: ImportOptions) =>
  Effect.gen(function* () {
    const target = yield* ImportTarget;
    const listed = yield* target.listProjects;
    const stage = stageOfWhere(options.where);
    const recorded = yield* recordedImports(stage);
    const known = new Set([...listed, ...recorded]);

    const asked = planImports(examples, new Set(), options.only);
    const plan = planImports(examples, known, options.only);
    const skipped = asked.filter(({ name }) => known.has(name));

    const earlier = skipped.filter(
      ({ name }) => Option.isNone(stage) || recorded.has(name)
    );

    yield* Console.log(
      `import-examples on ${target.label}: ${plan.length} to import, ${skipped.length} listed already`
    );
    yield* Effect.forEach(
      skipped,
      ({ name }) =>
        Console.log(
          listed.has(name)
            ? `  skip ${name}: listed already`
            : `  skip ${name}: imported already, as the ledger records`
        ),
      { discard: true }
    );

    if (options.dryRun) {
      yield* Effect.forEach(
        plan,
        ({ branch, name, url }) =>
          Console.log(`  would import ${name} from ${url} (${branch})`),
        { discard: true }
      );

      if (options.sources) {
        yield* Effect.forEach(
          earlier,
          ({ branch, name, url }) =>
            Console.log(
              `  would keep the source of ${name}: ${url} (${branch})`
            ),
          { discard: true }
        );
      }

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

          // Recorded before anything else can fail.
          yield* Option.match(stage, {
            onNone: () => Effect.void,
            onSome: (on) => record(importLines(on, example.key, at)),
          });

          const { heads, tags } = yield* target.counts(example.name);

          yield* Console.log(
            `imported ${example.name} (${example.kind}, ${example.branch}): main at ${made.landed?.slice(0, 12) ?? "a SHA an earlier unanswered call landed"}, ${heads} heads, ${tags} tags`
          );

          if (options.tags) {
            yield* backfillOne(example, tags, stage);
          }

          yield* warmOne(example.name);
        }),
      { discard: true }
    );

    if (options.tags && Option.isSome(stage)) {
      yield* Effect.forEach(
        earlier,
        (example) =>
          Effect.flatMap(target.counts(example.name), ({ tags }) =>
            backfillOne(example, tags, stage)
          ),
        { discard: true }
      );
    }

    if (options.sources) {
      yield* Effect.forEach(earlier, sourceOne, { discard: true });
    }

    if (options.warm) {
      yield* Effect.forEach(skipped, ({ name }) => warmOne(name), {
        discard: true,
      });
    }

    yield* Console.log(
      Option.isSome(stage)
        ? `imported ${plan.length} of ${plan.length}, each recorded in ${ledgerPath} as a kept import`
        : `imported ${plan.length} of ${plan.length} into the Node world (not recorded: the ledger is for stages)`
    );
  });

export const importExamples = <E, R>(
  argv: readonly string[],
  layersOf: (
    options: ImportOptions
  ) => Layer.Layer<ImportTarget | TagBackfill | Warmer, E, R>
): Effect.Effect<void, ImportExamplesFailed | E, R | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const options = yield* optionsOf(argv);

    return yield* run(options).pipe(Effect.provide(layersOf(options)));
  });
