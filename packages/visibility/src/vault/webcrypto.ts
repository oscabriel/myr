// A fresh AES-GCM-256 data key and IV per value, the data key wrapped with the
// master key by AES-KW (RFC 3394, which checks the key's integrity on unwrap).
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import {
  admitLength,
  SealedValueUnopenable,
  WriteOnlyValues,
} from "../vault.ts";
import type { SealedValue, ValueToSeal } from "../vault.ts";

/**
 * Which master key a value was sealed under. Only version 1 exists; a new
 * master key takes the next number, so values sealed under the old one can
 * be found and sealed again.
 */
const KEY_VERSION = 1;

const IV_BYTES = 12;

const KEY_BYTES = 32;

/**
 * Values are padded to a multiple of this many bytes before sealing, so a
 * ciphertext's length tells only which 64-byte step the value's length
 * falls in, not the length itself.
 */
const PAD_TO = 64;

const PAD_MARK = 0x80;

class MasterKeyUnusable extends Schema.TaggedError<MasterKeyUnusable>()(
  "MasterKeyUnusable",
  {}
) {}

const encodeBase64 = Schema.encodeEffect(Schema.Uint8ArrayFromBase64);

/**
 * The bytes in a buffer of their own. WebCrypto takes an `ArrayBuffer`-backed
 * view, and a decoded `Uint8Array` is typed over any buffer under Node's types.
 */
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes);

const decodeBase64 = (text: string) =>
  Effect.map(Schema.decodeEffect(Schema.Uint8ArrayFromBase64)(text), owned);

const padded = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const out = new Uint8Array((Math.floor(bytes.length / PAD_TO) + 1) * PAD_TO);

  out.set(bytes);
  out[bytes.length] = PAD_MARK;

  return out;
};

const unpadded = (bytes: Uint8Array) => {
  const end = bytes.findLastIndex((byte) => byte !== 0);

  return end !== -1 && bytes[end] === PAD_MARK
    ? Option.some(bytes.subarray(0, end))
    : Option.none();
};

const masterKeyBytes = (masterKey: Redacted.Redacted) =>
  Schema.decodeEffect(Schema.Uint8ArrayFromHex)(Redacted.value(masterKey)).pipe(
    Effect.mapError(() => new MasterKeyUnusable()),
    Effect.filterOrFail(
      (bytes) => bytes.length === KEY_BYTES,
      () => new MasterKeyUnusable()
    ),
    Effect.map(owned),
    Effect.orDie
  );

/**
 * Imported for each call: WebCrypto's import is a promise, and the layer is
 * built where nothing may be awaited (the platform's router, at module load).
 */
const importMasterKey = (bytes: Uint8Array<ArrayBuffer>) =>
  Effect.promise(() =>
    crypto.subtle.importKey("raw", bytes, "AES-KW", false, [
      "wrapKey",
      "unwrapKey",
    ])
  );

const freshDataKey = Effect.sync(() =>
  crypto.getRandomValues(new Uint8Array(KEY_BYTES))
).pipe(
  Effect.flatMap((raw) =>
    Effect.promise(() =>
      crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt"])
    ).pipe(Effect.ensuring(Effect.sync(() => raw.fill(0))))
  )
);

const seal = (master: CryptoKey, input: ValueToSeal) =>
  Effect.gen(function* () {
    yield* admitLength(input);

    const dataKey = yield* freshDataKey;

    const iv = yield* Effect.sync(() =>
      crypto.getRandomValues(new Uint8Array(IV_BYTES))
    );

    const ciphertext = yield* Effect.promise(() =>
      crypto.subtle.encrypt(
        { iv, name: "AES-GCM" },
        dataKey,
        padded(Redacted.value(input.value))
      )
    );

    const wrappedKey = yield* Effect.promise(() =>
      crypto.subtle.wrapKey("raw", dataKey, master, "AES-KW")
    );

    const [ciphertextText, ivText, wrappedKeyText] = yield* Effect.all([
      encodeBase64(new Uint8Array(ciphertext)),
      encodeBase64(iv),
      encodeBase64(new Uint8Array(wrappedKey)),
    ]).pipe(Effect.orDie);

    return {
      ciphertext: ciphertextText,
      iv: ivText,
      keyVersion: KEY_VERSION,
      wrappedKey: wrappedKeyText,
    } satisfies SealedValue;
  });

const unseal = (master: CryptoKey, sealed: SealedValue) =>
  Effect.gen(function* () {
    if (sealed.keyVersion !== KEY_VERSION) {
      return yield* new SealedValueUnopenable({ step: "keyVersion" });
    }

    const wrappedKey = yield* decodeBase64(sealed.wrappedKey).pipe(
      Effect.mapError(() => new SealedValueUnopenable({ step: "unwrap" }))
    );

    const dataKey = yield* Effect.tryPromise({
      catch: () => new SealedValueUnopenable({ step: "unwrap" }),
      try: () =>
        crypto.subtle.unwrapKey(
          "raw",
          wrappedKey,
          master,
          "AES-KW",
          "AES-GCM",
          false,
          ["decrypt"]
        ),
    });

    const [iv, ciphertext] = yield* Effect.all([
      decodeBase64(sealed.iv),
      decodeBase64(sealed.ciphertext),
    ]).pipe(
      Effect.mapError(() => new SealedValueUnopenable({ step: "decrypt" }))
    );

    const plain = yield* Effect.tryPromise({
      catch: () => new SealedValueUnopenable({ step: "decrypt" }),
      try: () =>
        crypto.subtle.decrypt({ iv, name: "AES-GCM" }, dataKey, ciphertext),
    });

    const bytes = yield* Effect.fromOption(
      unpadded(new Uint8Array(plain))
    ).pipe(
      Effect.mapError(() => new SealedValueUnopenable({ step: "decrypt" }))
    );

    return yield* Effect.try({
      catch: () => new SealedValueUnopenable({ step: "decrypt" }),
      try: () =>
        Redacted.make(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            bytes
          )
        ),
    });
  }).pipe(Effect.orDie);

/** A key of any other form is a defect when the layer is built, and the defect never holds the key. */
export const WriteOnlyValuesWebCrypto = (
  masterKey: Redacted.Redacted
): Layer.Layer<WriteOnlyValues> =>
  Layer.effect(
    WriteOnlyValues,
    masterKeyBytes(masterKey).pipe(
      Effect.map((bytes) =>
        WriteOnlyValues.of({
          open: (sealed) =>
            Effect.flatMap(importMasterKey(bytes), (master) =>
              unseal(master, sealed)
            ),
          put: (input) =>
            Effect.flatMap(importMasterKey(bytes), (master) =>
              seal(master, input)
            ),
        })
      )
    )
  );
