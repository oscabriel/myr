/**
 * The code reads' cache: what an object id names never changes, so a read
 * keyed by `<repo>:<kind>:<object id>` (a tree, a blob, a commit, a commit's
 * diff, a blame at a commit) is read once. A `Context.Reference` whose
 * default caches nothing, so every host composes before one is given; the
 * platform gives one held in a layer (no module-level state, principle 6).
 * `main` is never a key: it resolves through the project's record on every
 * call.
 */
import { Context } from "effect";
import type { Effect } from "effect";

/** The code reads, each kept by its key once read. */
export interface CodeReads {
  /** `read`, or what it gave before for `key`. */
  readonly through: <A, E, R>(
    key: string,
    read: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
}

export const CodeCache = Context.Reference<CodeReads>("project/CodeCache", {
  defaultValue: () => ({ through: (_key, read) => read }),
});
