import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { EnvKey } from "@repo/protocol/ids";
import { Refusal, ValueTooShort } from "@repo/protocol/refusal";
import {
  Cause,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Redacted,
  Result,
  Schema,
} from "effect";

import {
  SealedValue,
  SealedValueUnopenable,
  WriteOnlyValues,
} from "../src/vault.ts";
import { WriteOnlyValuesWebCrypto } from "../src/vault/webcrypto.ts";

// A fixed test master key and a second one, 32 bytes each as 64 hex
// characters (the form the platform decodes `MASTER_KEY` in).
const masterKey = WriteOnlyValuesWebCrypto(
  Redacted.make(
    "00112233445566778899aabbccddeeff00112233445566778899AABBCCDDEEFF"
  )
);

const otherMasterKey = WriteOnlyValuesWebCrypto(
  Redacted.make(
    "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100"
  )
);

const key = EnvKey.make("SENTRY_AUTH_TOKEN");

/** A token-shaped value of 22 characters. */
const token = "sntrys_eyJpYXQiOjE3MjA";

const put = (value: string, acknowledgeShort = false) =>
  WriteOnlyValues.use((values) =>
    values.put({ acknowledgeShort, key, value: Redacted.make(value) })
  );

const open = (sealed: SealedValue) =>
  WriteOnlyValues.use((values) => values.open(sealed)).pipe(
    Effect.map((value) => Redacted.value(value))
  );

/** The sealed value with one byte of `field` changed. */
const tampered = (
  sealed: SealedValue,
  field: "ciphertext" | "iv" | "wrappedKey"
): SealedValue => {
  const bytes = Schema.decodeSync(Schema.Uint8ArrayFromBase64)(sealed[field]);

  return {
    ...sealed,
    [field]: Schema.encodeSync(Schema.Uint8ArrayFromBase64)(
      bytes.map((byte, index) => (index === 0 ? (byte + 1) % 256 : byte))
    ),
  };
};

const base64 = Schema.encodeSync(Schema.StringFromBase64);

/** What an effect failed with: none when it succeeded. */
const refusalOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.result(effect).pipe(Effect.map(Result.getFailure));

/** The defect an effect died with. */
const defectOf = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

describe("write-only values over WebCrypto", () => {
  it.effect("opens what it sealed", () =>
    Effect.gen(function* () {
      const sealed = yield* put(token);

      expect(sealed.keyVersion).toBe(1);
      expect(yield* open(sealed)).toBe(token);
    }).pipe(Effect.provide(masterKey))
  );

  it.effect(
    "opens a value byte for byte: trailing NULs, a leading BOM, a long one",
    () =>
      Effect.gen(function* () {
        const odd = [
          `${token}\u0000\u0000`,
          `﻿${token}`,
          "-----BEGIN PRIVATE KEY-----\n".padEnd(1700, "A"),
        ];

        const opened = yield* Effect.forEach(odd, (value) =>
          put(value).pipe(Effect.flatMap(open))
        );

        expect(opened).toStrictEqual(odd);
      }).pipe(Effect.provide(masterKey))
  );

  it.effect("seals the same value twice under fresh data keys and IVs", () =>
    Effect.gen(function* () {
      const first = yield* put(token);
      const second = yield* put(token);

      expect(second.ciphertext).not.toBe(first.ciphertext);
      expect(second.wrappedKey).not.toBe(first.wrappedKey);
      expect(second.iv).not.toBe(first.iv);
      expect(yield* open(second)).toBe(token);
    }).pipe(Effect.provide(masterKey))
  );

  it.effect(
    "will not start on a master key that is not 32 bytes of hex, and never says the key",
    () =>
      Effect.gen(function* () {
        const shortKey = "00112233445566778899aabbccddeeff0011223344556677";
        const notHex = "zz".repeat(32);

        const defects = yield* Effect.forEach([shortKey, notHex], (text) =>
          Effect.exit(
            put(token).pipe(
              Effect.provide(WriteOnlyValuesWebCrypto(Redacted.make(text)))
            )
          ).pipe(
            Effect.map((exit) => {
              const defect = defectOf(exit);

              return [
                Predicate.isTagged(defect, "MasterKeyUnusable"),
                JSON.stringify(defect).includes(text),
              ];
            })
          )
        );

        expect(defects).toStrictEqual([
          [true, false],
          [true, false],
        ]);
      })
  );

  it("is built at once, awaiting nothing: the master key is imported per call", () => {
    // The platform builds its router at module load and refuses a build
    // that awaits (`router-build.ts`), so the vault's layer must build synchronously.
    const built = Effect.runSyncExit(
      Layer.build(masterKey).pipe(Effect.scoped)
    );

    expect(Exit.isFailure(built) ? Cause.pretty(built.cause) : "built").toBe(
      "built"
    );
  });

  it.effect("does not open a value under another master key", () =>
    Effect.gen(function* () {
      const sealed = yield* put(token).pipe(Effect.provide(masterKey));

      const exit = yield* Effect.exit(
        open(sealed).pipe(Effect.provide(otherMasterKey))
      );

      expect(defectOf(exit)).toStrictEqual(
        new SealedValueUnopenable({ step: "unwrap" })
      );
    })
  );

  it.effect(
    "does not open a value with a byte changed in any of its fields",
    () =>
      Effect.gen(function* () {
        const sealed = yield* put(token);

        const steps = yield* Effect.forEach(
          ["ciphertext", "iv", "wrappedKey"] as const,
          (field) =>
            Effect.exit(open(tampered(sealed, field))).pipe(
              Effect.map(defectOf)
            )
        );

        expect(steps).toStrictEqual([
          new SealedValueUnopenable({ step: "decrypt" }),
          new SealedValueUnopenable({ step: "decrypt" }),
          new SealedValueUnopenable({ step: "unwrap" }),
        ]);
      }).pipe(Effect.provide(masterKey))
  );

  it.effect("does not open a value sealed under a key version it lacks", () =>
    Effect.gen(function* () {
      const sealed = yield* put(token);

      const exit = yield* Effect.exit(open({ ...sealed, keyVersion: 2 }));

      expect(defectOf(exit)).toStrictEqual(
        new SealedValueUnopenable({ step: "keyVersion" })
      );
    }).pipe(Effect.provide(masterKey))
  );

  it.effect(
    "refuses an 11-character value unless the decider acknowledges it",
    () =>
      Effect.gen(function* () {
        const short = "abcdefghijk";

        expect(yield* refusalOf(put(short))).toStrictEqual(
          Option.some(ValueTooShort.of(key, 12))
        );
        expect(yield* open(yield* put(short, true))).toBe(short);
      }).pipe(Effect.provide(masterKey))
  );

  it.effect(
    "refuses a 2-character value even acknowledged, and says to set a longer one",
    () =>
      Effect.gen(function* () {
        expect(yield* refusalOf(put("ab", true))).toStrictEqual(
          Option.some(
            new ValueTooShort({
              key,
              minimum: 3,
              next: `${Brand.cli} env set SENTRY_AUTH_TOKEN`,
            })
          )
        );
        expect(yield* open(yield* put("abc", true))).toBe("abc");
      }).pipe(Effect.provide(masterKey))
  );

  it.effect("counts an emoji as one character", () =>
    Effect.gen(function* () {
      // Eleven characters in 22 UTF-16 units.
      const emoji = "🔑".repeat(11);

      expect(yield* refusalOf(put(emoji))).toStrictEqual(
        Option.some(ValueTooShort.of(key, 12))
      );
      expect(yield* open(yield* put(`${emoji}x`))).toBe(`${emoji}x`);
    }).pipe(Effect.provide(masterKey))
  );

  it.effect("keeps neither the value nor its length in what it seals", () =>
    Effect.gen(function* () {
      const twelve = "x7Kq2mVp9Lw4";
      const forty = "Zr8nT3vQ6yHc1Pw5Ks9Ld2Fg7Jb4Mx0Ae6Nu3Wt8";
      const sealing = [twelve, forty, token];

      const sealed = yield* Effect.forEach(sealing, (value) =>
        put(value).pipe(
          Effect.flatMap(Schema.encodeEffect(SealedValue)),
          Effect.map((encoded) => JSON.stringify(encoded))
        )
      );

      expect(
        sealed.filter(
          (json, index) =>
            json.includes(sealing[index] ?? "") ||
            json.includes(base64(sealing[index] ?? ""))
        )
      ).toStrictEqual([]);
      // Values of 12, 40 and 22 characters seal to the same size: the
      // ciphertext's length says nothing about the value's.
      expect(new Set(sealed.map(({ length }) => length)).size).toBe(1);
    }).pipe(Effect.provide(masterKey))
  );

  it.effect("refuses, and fails to open, without the value or its length", () =>
    Effect.gen(function* () {
      const short = [
        { acknowledged: false, value: "abcdefghijk" },
        { acknowledged: true, value: "q7" },
      ];

      const refusals = yield* Effect.forEach(short, ({ acknowledged, value }) =>
        Effect.flip(put(value, acknowledged)).pipe(
          Effect.flatMap(Schema.encodeEffect(Refusal)),
          Effect.map((encoded) => JSON.stringify(encoded))
        )
      );

      const exit = yield* Effect.exit(
        open(tampered(yield* put(token), "ciphertext"))
      );

      const defect = yield* Schema.encodeUnknownEffect(SealedValueUnopenable)(
        defectOf(exit)
      ).pipe(Effect.map((encoded) => JSON.stringify(encoded)));

      expect(refusals).toStrictEqual([
        expect.stringContaining('"minimum":12'),
        expect.stringContaining('"minimum":3'),
      ]);
      expect(
        [...refusals, defect].map((json, index) => {
          const { value } = short[index] ?? { value: token };

          return [json.includes(value), json.includes(String(value.length))];
        })
      ).toStrictEqual([
        [false, false],
        [false, false],
        [false, false],
      ]);
    }).pipe(Effect.provide(masterKey))
  );
});
