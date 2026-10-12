// The append-only ledger of what this build made; teardown acts on nothing
// else. It is committed and holds names only, never a token. A deletion is a
// later `deleted` line folded into its entry on read, never a rewrite.
import { Context, Effect, FileSystem, Schema } from "effect";
import type { DateTime, PlatformError } from "effect";

const resourceFields = {
  kind: Schema.Literals(["namespace", "repo", "project"]),
  name: Schema.NonEmptyString,
  namespace: Schema.optionalKey(Schema.NonEmptyString),
  stage: Schema.NonEmptyString,
};

const Made = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  // An `import` is kept, not a throwaway: teardown never selects it.
  by: Schema.Literals(["smoke", "swarm", "seed", "import"]),
  ...resourceFields,
  note: Schema.optionalKey(Schema.NonEmptyString),
});

const Deleted = Schema.Struct({
  deletedAt: Schema.DateTimeUtcFromString,
  ...resourceFields,
});

export const Created = Schema.Struct({
  ...Made.fields,
  deletedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
});

export type Created = typeof Created.Type;

export const ledgerPath = "infra/created.jsonl";

export const LedgerFile = Context.Reference<string>("infra/LedgerFile", {
  defaultValue: () =>
    decodeURIComponent(new URL("created.jsonl", import.meta.url).pathname),
});

const MadeLine = Schema.fromJsonString(Made);

const DeletedLine = Schema.fromJsonString(Deleted);

const Line = Schema.fromJsonString(Schema.Union([Made, Deleted]));

type Resource = Pick<Created, "kind" | "name" | "namespace" | "stage">;

const sameResource = (one: Resource, other: Resource): boolean =>
  one.kind === other.kind &&
  one.name === other.name &&
  one.namespace === other.namespace &&
  one.stage === other.stage;

// A `deleted` line marks the latest unmarked entry before it naming the same
// resource; one matching nothing changes nothing.
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

export const recordCreated = (
  entry: Created
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* LedgerFile;

    // MadeLine drops `deletedAt`: it is never written on an entry's own line.
    const line = yield* Schema.encodeEffect(MadeLine)(entry).pipe(Effect.orDie);

    yield* fs.writeFileString(file, `${line}\n`, { flag: "a" });
  });

export const recordDeleted = (
  entry: Created,
  at: DateTime.Utc
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* LedgerFile;

    const line = yield* Schema.encodeEffect(DeletedLine)({
      ...entry,
      deletedAt: at,
    }).pipe(Effect.orDie);

    yield* fs.writeFileString(file, `${line}\n`, { flag: "a" });
  });

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

export const isRecorded = (
  ledger: readonly Created[],
  resource: Resource
): boolean =>
  ledger.some(
    (entry) => entry.deletedAt === undefined && sameResource(resource, entry)
  );

export const throwawayName = (by: Created["by"], run: string) => `${by}-${run}`;
