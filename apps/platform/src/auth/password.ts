import { Effect, Redacted, Schema } from "effect";

// 100,000 iterations is the most workerd's PBKDF2 accepts on Cloudflare.
export const PasswordPolicy = {
  hashBytes: 32,
  iterations: 100_000,
  saltBytes: 16,
} as const;

const ALGORITHM = "pbkdf2-sha256";

const STORED =
  /^pbkdf2-sha256\$(?<iterations>[1-9]\d{0,5})\$(?<salt>[\w-]+)\$(?<hash>[\w-]+)$/u;

export const PasswordHash = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((stored) => {
      const iterations = Number(STORED.exec(stored)?.groups?.iterations ?? 0);

      return iterations > 0 && iterations <= PasswordPolicy.iterations
        ? true
        : `a hash of the form ${ALGORITHM}$<iterations>$<salt>$<hash>`;
    })
  ),
  Schema.brand("PasswordHash")
);

export type PasswordHash = typeof PasswordHash.Type;

const Base64Url = Schema.Uint8ArrayFromBase64Url;

const encodeBase64Url = Schema.encodeEffect(Base64Url);

const decodeBase64Url = Schema.decodeEffect(Base64Url);

const utf8 = (text: string) => new TextEncoder().encode(text);

// The hash means nothing without the Worker's `PASSWORD_PEPPER`.
const peppered = (pepper: Redacted.Redacted, password: Redacted.Redacted) =>
  Effect.promise(() =>
    crypto.subtle.importKey(
      "raw",
      utf8(Redacted.value(pepper)),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"]
    )
  ).pipe(
    Effect.flatMap((key) =>
      Effect.promise(() =>
        crypto.subtle.sign("HMAC", key, utf8(Redacted.value(password)))
      )
    )
  );

const derive = (
  pepper: Redacted.Redacted,
  password: Redacted.Redacted,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
) =>
  peppered(pepper, password).pipe(
    Effect.flatMap((mac) =>
      Effect.promise(() =>
        crypto.subtle.importKey("raw", mac, "PBKDF2", false, ["deriveBits"])
      )
    ),
    Effect.flatMap((key) =>
      Effect.promise(() =>
        crypto.subtle.deriveBits(
          { hash: "SHA-256", iterations, name: "PBKDF2", salt },
          key,
          PasswordPolicy.hashBytes * 8
        )
      )
    ),
    Effect.map((bits) => new Uint8Array(bits))
  );

// Constant time: the stored bytes are signed under a fresh random key, and `verify` checks the derived bytes against it.
const sameBytes = (
  derived: Uint8Array<ArrayBuffer>,
  stored: Uint8Array<ArrayBuffer>
) =>
  Effect.promise(() =>
    crypto.subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign", "verify"]
    )
  ).pipe(
    Effect.flatMap((key) =>
      Effect.promise(() => crypto.subtle.sign("HMAC", key, stored)).pipe(
        Effect.flatMap((signature) =>
          Effect.promise(() =>
            crypto.subtle.verify("HMAC", key, signature, derived)
          )
        )
      )
    )
  );

export const hashPasswordWith =
  (iterations: number) =>
  (pepper: Redacted.Redacted, password: Redacted.Redacted) =>
    Effect.gen(function* () {
      const salt = crypto.getRandomValues(
        new Uint8Array(PasswordPolicy.saltBytes)
      );

      const hash = yield* derive(pepper, password, salt, iterations);

      const parts = yield* Effect.all([
        encodeBase64Url(salt),
        encodeBase64Url(hash),
      ]).pipe(Effect.orDie);

      return PasswordHash.make(
        [ALGORITHM, String(iterations), ...parts].join("$")
      );
    });

export const hashPassword = hashPasswordWith(PasswordPolicy.iterations);

export const verifyPassword = (
  pepper: Redacted.Redacted,
  password: Redacted.Redacted,
  stored: PasswordHash
) =>
  Effect.gen(function* () {
    const { groups } = STORED.exec(stored) ?? {};

    const iterations = Number(groups?.iterations);

    const [salt, expected] = yield* Effect.all([
      decodeBase64Url(groups?.salt ?? ""),
      decodeBase64Url(groups?.hash ?? ""),
    ]).pipe(Effect.orDie);

    const actual = yield* derive(
      pepper,
      password,
      new Uint8Array(salt),
      iterations
    );

    return {
      needsRehash: iterations < PasswordPolicy.iterations,
      ok: yield* sameBytes(actual, new Uint8Array(expected)),
    };
  });
