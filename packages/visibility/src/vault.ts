/**
 * Write-only values (VL §8.4, §8.6; OSR §2.2 `writeOnly`): a decider sets a
 * value for a `@sensitive` item, and nobody reads it back, the decider and
 * the platform's contracts included. Each value is sealed under a random
 * data key, wrapped by the platform's `MASTER_KEY`
 * (`./vault/webcrypto`, issue 610).
 */
import type { EnvKey } from "@repo/protocol/ids";
import type { ValueTooShort } from "@repo/protocol/refusal";
import { Context, Schema } from "effect";
import type { Effect, Redacted } from "effect";

/** Bytes as base64 text. */
const Base64 = Schema.String.check(Schema.isBase64());

/**
 * A value as the Project DO stores it: its ciphertext, the IV it was sealed
 * with, its data key wrapped by the master key, and which master key that
 * was. Nothing in it is the value.
 */
export const SealedValue = Schema.Struct({
  ciphertext: Base64,
  iv: Base64,
  keyVersion: Schema.Int,
  wrappedKey: Base64,
});

export type SealedValue = typeof SealedValue.Type;

/** Seals values, and opens one only for a landed run. */
export class WriteOnlyValues extends Context.Service<
  WriteOnlyValues,
  {
    /**
     * Seals `value` for `key`. A short value is `ValueTooShort` unless the
     * decider acknowledged it; a very short one is refused even then.
     */
    readonly put: (input: {
      readonly key: EnvKey;
      readonly value: Redacted.Redacted;
      readonly acknowledgeShort: boolean;
    }) => Effect.Effect<SealedValue, ValueTooShort>;
    /** Opens a sealed value, for a landed run only; never behind a contract. */
    readonly open: (sealed: SealedValue) => Effect.Effect<Redacted.Redacted>;
  }
>()("visibility/WriteOnlyValues") {}
