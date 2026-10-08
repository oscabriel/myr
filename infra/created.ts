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
 */
import { Context, Effect, FileSystem, Schema } from "effect";
import type { PlatformError } from "effect";

/** One throwaway resource, as the run that made it records it. */
export const Created = Schema.Struct({
  /** When the run made it. */
  at: Schema.DateTimeUtcFromString,
  /** The job whose run made it. */
  by: Schema.Literals(["smoke", "swarm", "seed"]),
  kind: Schema.Literals(["namespace", "repo", "project"]),
  name: Schema.NonEmptyString,
  /** The Artifacts namespace that holds it, for a repo. */
  namespace: Schema.optionalKey(Schema.NonEmptyString),
  stage: Schema.NonEmptyString,
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

const CreatedLine = Schema.fromJsonString(Created);

/** Appends one entry to the ledger as one JSON line. */
export const recordCreated = (
  entry: Created
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* LedgerFile;

    // A `Created` value always encodes: every field is a string or a DateTime.
    const line = yield* Schema.encodeEffect(CreatedLine)(entry).pipe(
      Effect.orDie
    );

    yield* fs.writeFileString(file, `${line}\n`, { flag: "a" });
  });

/**
 * Every entry in the ledger, in the order the runs wrote them. A ledger no run
 * has written yet is empty; a line that is not a `Created` entry fails it.
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

  return yield* Effect.forEach(lines, (line) =>
    Schema.decodeEffect(CreatedLine)(line)
  );
});

/** A throwaway's name: the job that made it, then its run (`smoke-r1`). */
export const throwawayName = (by: Created["by"], run: string) => `${by}-${run}`;
