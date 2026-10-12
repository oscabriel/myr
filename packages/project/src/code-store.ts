import { Context, Effect, Option } from "effect";

/** A store of text by key, whose every failure reads as a miss. */
export interface CodeStoreApi {
  readonly get: (key: string) => Effect.Effect<Option.Option<string>>;
  readonly put: (key: string, value: string) => Effect.Effect<void>;
}

export const MAX_KEY_BYTES = 1024;

/** A key over the limit is a caller's bug (hash the path), so it dies rather than misses. */
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
