/**
 * The ledger of throwaway resources: every namespace, repo or project a smoke
 * run, a swarm run or a `seed --as` copy makes on a stage is appended here as
 * one JSON line, so teardown acts only on what this build made, never on a
 * stage's own resources or on anything else in the account.
 *
 * The ledger is committed and holds names only, never a token. A throwaway is
 * named by the job that made it and its run (`smoke-<run>`, `swarm-<run>`),
 * never by the brand (AGENTS.md principle 5); a `seed --as` copy keeps the
 * name it was given and is recorded by that name.
 *
 * History is only ever appended. When teardown deletes a throwaway it appends
 * a `deleted` line naming it (`deletedAt` and the entry's kind, name,
 * namespace and stage), and reading folds that line into the entry it names
 * as `deletedAt`; the entry's own line stays as it was written.
 */
import { Context, Effect, FileSystem, Schema } from "effect";
import type { DateTime, PlatformError } from "effect";

/** What names one resource, on the line that records it and on the one that marks it deleted. */
const resourceFields = {
  kind: Schema.Literals(["namespace", "repo", "project"]),
  name: Schema.NonEmptyString,
  /** The Artifacts namespace that holds it, for a repo. */
  namespace: Schema.optionalKey(Schema.NonEmptyString),
  stage: Schema.NonEmptyString,
};

/** The line a run appends when it makes a throwaway. */
const Made = Schema.Struct({
  /** When the run made it. */
  at: Schema.DateTimeUtcFromString,
  /** The job whose run made it. */
  by: Schema.Literals(["smoke", "swarm", "seed"]),
  ...resourceFields,
});

/** The line teardown appends when it deletes a throwaway. */
const Deleted = Schema.Struct({
  deletedAt: Schema.DateTimeUtcFromString,
  ...resourceFields,
});

/** One throwaway resource, as the run that made it records it. */
export const Created = Schema.Struct({
  ...Made.fields,
  /** When teardown deleted it: read from a later `deleted` line, never written on the entry's own. */
  deletedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
});

export type Created = typeof Created.Type;

/** The ledger, relative to the repo root. */
export const ledgerPath = "infra/created.jsonl";

/**
 * The file the ledger is read from and appended to: the repo's own
 * `ledgerPath` (beside this module), unless a test points it elsewhere.
 */
export const LedgerFile = Context.Reference<string>("infra/LedgerFile", {
  defaultValue: () =>
    decodeURIComponent(new URL("created.jsonl", import.meta.url).pathname),
});

const MadeLine = Schema.fromJsonString(Made);

const DeletedLine = Schema.fromJsonString(Deleted);

const Line = Schema.fromJsonString(Schema.Union([Made, Deleted]));

/** What names one resource on a stage, whichever line it is read from. */
type Resource = Pick<Created, "kind" | "name" | "namespace" | "stage">;

/** Whether two lines name the same resource on the same stage. */
const sameResource = (one: Resource, other: Resource): boolean =>
  one.kind === other.kind &&
  one.name === other.name &&
  one.namespace === other.namespace &&
  one.stage === other.stage;

/**
 * Each entry with the `deleted` lines folded in: a `deleted` line marks the
 * latest entry before it that names the same resource and is not yet marked.
 * One that matches no such entry changes nothing.
 */
const folded = (
  lines: readonly (typeof Made.Type | typeof Deleted.Type)[]
): readonly Created[] => {
  const entries: Created[] = [];

  for (const line of lines) {
    if ("deletedAt" in line) {
      const index = entries.findLastIndex(
        (entry) => entry.deletedAt === undefined && sameResource(line, entry)
      );

      const marked = entries[index];

      if (marked !== undefined) {
        entries[index] = { ...marked, deletedAt: line.deletedAt };
      }
    } else {
      entries.push(line);
    }
  }

  return entries;
};

/** Appends one entry to the ledger as one JSON line. */
export const recordCreated = (
  entry: Created
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* LedgerFile;

    // A `Created` value always encodes: every field is a string or a
    // DateTime. Its line is the run's own: a `deletedAt` is never written on it.
    const line = yield* Schema.encodeEffect(MadeLine)(entry).pipe(Effect.orDie);

    yield* fs.writeFileString(file, `${line}\n`, { flag: "a" });
  });

/**
 * Appends a `deleted` line for `entry`, deleted at `at`; the entry's own line
 * is never rewritten.
 */
export const recordDeleted = (
  entry: Created,
  at: DateTime.Utc
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* LedgerFile;

    // Every field is a string or a DateTime, so the line always encodes; it
    // names the entry and when it was deleted, and nothing else of it.
    const line = yield* Schema.encodeEffect(DeletedLine)({
      ...entry,
      deletedAt: at,
    }).pipe(Effect.orDie);

    yield* fs.writeFileString(file, `${line}\n`, { flag: "a" });
  });

/**
 * Every entry in the ledger, in the order the runs wrote them, each one
 * teardown deleted with its `deletedAt`. A ledger no run has written yet is
 * empty; a line that is neither a run's entry nor a `deleted` line fails it.
 */
export const readLedger: Effect.Effect<
  readonly Created[],
  PlatformError.PlatformError | Schema.SchemaError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* LedgerFile;

  if (!(yield* fs.exists(file))) {
    return [];
  }

  const lines = (yield* fs.readFileString(file))
    .split("\n")
    .filter((line) => line.length > 0);

  return folded(
    yield* Effect.forEach(lines, (line) => Schema.decodeEffect(Line)(line))
  );
});

/**
 * Whether the ledger holds `resource` and teardown has not deleted it: a run
 * records what it makes once, and again once teardown deleted the last one.
 */
export const isRecorded = (
  ledger: readonly Created[],
  resource: Resource
): boolean =>
  ledger.some(
    (entry) => entry.deletedAt === undefined && sameResource(resource, entry)
  );

/** A throwaway's name: the job that made it, then its run (`smoke-r1`). */
export const throwawayName = (by: Created["by"], run: string) => `${by}-${run}`;
