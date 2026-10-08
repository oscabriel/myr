/**
 * Write-only values (`writeOnly`): a decider sets a
 * value for a `@sensitive` item, and nobody reads it back, the decider and
 * the platform's contracts included. Each value is sealed under a random
 * data key, wrapped by the platform's `MASTER_KEY` (`./vault/webcrypto`).
 */
import type { EnvKey } from "@repo/protocol/ids";
import { ValueTooShort } from "@repo/protocol/refusal";
import { Context, Effect, Redacted, Schema } from "effect";

/**
 * The shortest value stored without the decider acknowledging it
 * (varlock's own threshold): masking cannot protect a shorter one, and it may
 * be guessed.
 */
export const MIN_LENGTH = 12;

/**
 * The shortest value stored at all, and the shortest the leak scan looks
 * for: below it a value matches ordinary text everywhere.
 */
export const HARD_MIN_LENGTH = 3;

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

/**
 * A sealed value that does not open: its master key is not this one, a
 * byte of it changed, or it names a key version this platform does not
 * hold. A defect, never a refusal: a stored row that will not open is the
 * platform's fault, and nothing about the value is in it.
 */
export class SealedValueUnopenable extends Schema.TaggedError<SealedValueUnopenable>()(
  "SealedValueUnopenable",
  { step: Schema.Literals(["keyVersion", "unwrap", "decrypt"]) }
) {}

/** A value a decider sets for one item, and whether they accept a short one. */
export interface ValueToSeal {
  readonly acknowledgeShort: boolean;
  readonly key: EnvKey;
  readonly value: Redacted.Redacted;
}

const graphemes = new Intl.Segmenter();

/**
 * How many characters a value has, as a reader counts them (grapheme
 * clusters): an emoji or an accented letter is one, whatever its UTF-16
 * length.
 */
export const charactersIn = (value: string) =>
  [...graphemes.segment(value)].length;

/**
 * Whether a value is long enough to seal. Under `MIN_LENGTH` it is refused
 * unless acknowledged; under `HARD_MIN_LENGTH` it is refused even then, and
 * the refusal says to set a longer one. A refusal names the minimum, never
 * the value or its length.
 */
export const admitLength = ({
  acknowledgeShort,
  key,
  value,
}: ValueToSeal): Effect.Effect<void, ValueTooShort> => {
  const length = charactersIn(Redacted.value(value));

  if (length < HARD_MIN_LENGTH) {
    return Effect.fail(ValueTooShort.belowFloor(key, HARD_MIN_LENGTH));
  }

  return length < MIN_LENGTH && !acknowledgeShort
    ? Effect.fail(ValueTooShort.of(key, MIN_LENGTH))
    : Effect.void;
};

/** Seals values, and opens one only for a landed run. */
export class WriteOnlyValues extends Context.Service<
  WriteOnlyValues,
  {
    /**
     * Seals `value` for `key`. A short value is `ValueTooShort` unless the
     * decider acknowledged it; a very short one is refused even then.
     */
    readonly put: (
      input: ValueToSeal
    ) => Effect.Effect<SealedValue, ValueTooShort>;
    /** Opens a sealed value, for a landed run only; never behind a contract. */
    readonly open: (sealed: SealedValue) => Effect.Effect<Redacted.Redacted>;
  }
>()("visibility/WriteOnlyValues") {}
