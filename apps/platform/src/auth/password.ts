/**
 * Passwords, stored only as a salted, peppered PBKDF2-SHA-256 hash through
 * WebCrypto, so the same code runs in workerd and in Node. A password and
 * the pepper never leave this module except as the hash.
 */
import { Effect, Redacted, Schema } from "effect";

/**
 * Today's setting. 100,000 iterations is the most workerd's PBKDF2 accepts
 * on Cloudflare (ASSUMPTION: the cap is a production runtime setting; the
 * open-source workerd in node_modules accepted 10,000,001 in a probe). The
 * pepper makes a stolen table useless without the Worker's secret.
 */
export const PasswordPolicy = {
  hashBytes: 32,
  iterations: 100_000,
  saltBytes: 16,
} as const;

const ALGORITHM = "pbkdf2-sha256";

/** `pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>`: what was used, beside what it made. */
const STORED =
  /^pbkdf2-sha256\$(?<iterations>[1-9]\d{0,5})\$(?<salt>[\w-]+)\$(?<hash>[\w-]+)$/u;

/**
 * A stored password hash in the one form this platform writes, with an
 * iteration count workerd can derive (at most `PasswordPolicy.iterations`).
 */
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

/**
 * The password's HMAC-SHA-256 under the pepper: what PBKDF2 stretches, so
 * the hash means nothing without the Worker's `PASSWORD_PEPPER`.
 */
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

/** PBKDF2-SHA-256 over the peppered password. */
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

/**
 * Whether the derived bytes are the stored ones, compared in constant time
 * by WebCrypto: the stored bytes are signed under a fresh random HMAC key,
 * and `verify` checks the derived bytes against that signature (BoringSSL's
 * `CRYPTO_memcmp` in workerd, `timingSafeEqual` in Node). Nothing here
 * stops at the first differing byte.
 */
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

/** A hash of `password` at `iterations`, with a fresh 16-byte salt. */
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

/** A hash of `password` at today's setting. */
export const hashPassword = hashPasswordWith(PasswordPolicy.iterations);

/**
 * Whether `password` is the one `stored` was made from, compared in
 * constant time over the derived bytes, and whether `stored` was made with
 * fewer iterations than today's setting and should be replaced.
 */
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
