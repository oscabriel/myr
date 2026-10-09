/**
 * The code history's durable store: what a code read computed from immutable
 * ids (a why, a path's history), kept as text across isolates. A
 * `Context.Reference` whose default stores nothing, so every host composes
 * before a store is given, as `CodeCache` does; the platform gives one over
 * its `CODE_CACHE` bucket (`code-store/binding.ts`).
 *
 * Values are text the caller encodes and decodes with Schema: a value that
 * fails to decode is the caller's miss (principle 2). Keys belong to the
 * caller too, and hold at most 1,024 bytes (R2's limit), so a caller hashes
 * a path rather than spelling it.
 */
import { Context, Effect, Option } from "effect";

/** A store of text by key, whose every failure reads as a miss. */
export interface CodeStoreApi {
  /** The text kept under `key`; none when nothing is, or the store failed. */
  readonly get: (key: string) => Effect.Effect<Option.Option<string>>;
  /** Keeps `value` under `key`; a store that fails keeps nothing, silently to the caller. */
  readonly put: (key: string, value: string) => Effect.Effect<void>;
}

/** The longest key a store takes, in UTF-8 bytes: R2's limit. */
export const MAX_KEY_BYTES = 1024;

/**
 * `key`, once it fits: a longer key is a caller's bug (it should have hashed
 * the path), so it dies rather than reading as a miss.
 */
export const fittingKey = (key: string) =>
  new TextEncoder().encode(key).byteLength > MAX_KEY_BYTES
    ? Effect.die(
        `a code store key holds at most ${MAX_KEY_BYTES} bytes; hash its path`
      )
    : Effect.succeed(key);

export const CodeStore = Context.Reference<CodeStoreApi>("project/CodeStore", {
  defaultValue: () => ({
    get: (key) => Effect.as(fittingKey(key), Option.none()),
    put: (key) => Effect.asVoid(fittingKey(key)),
  }),
});
