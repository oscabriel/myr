// Nobody reads a write-only value back, the decider and the platform's
// contracts included.
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

const Base64 = Schema.String.check(Schema.isBase64());

export const SealedValue = Schema.Struct({
  ciphertext: Base64,
  iv: Base64,
  keyVersion: Schema.Int,
  wrappedKey: Base64,
});

export type SealedValue = typeof SealedValue.Type;

/** A defect, never a refusal: a stored row that will not open is the platform's fault. */
export class SealedValueUnopenable extends Schema.TaggedError<SealedValueUnopenable>()(
  "SealedValueUnopenable",
  { step: Schema.Literals(["keyVersion", "unwrap", "decrypt"]) }
) {}

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

/** A refusal names the minimum, never the value or its length. */
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

export class WriteOnlyValues extends Context.Service<
  WriteOnlyValues,
  {
    readonly put: (
      input: ValueToSeal
    ) => Effect.Effect<SealedValue, ValueTooShort>;
    /** Opens a sealed value, for a landed run only; never behind a contract. */
    readonly open: (sealed: SealedValue) => Effect.Effect<Redacted.Redacted>;
  }
>()("visibility/WriteOnlyValues") {}
