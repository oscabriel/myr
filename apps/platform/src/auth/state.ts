/**
 * A sign-in in progress travels in the sign-in form itself, sealed: the
 * OAuth request the provider validated, the form's CSRF token, and when it
 * stops being good, signed with HMAC-SHA-256 under `COOKIE_KEY` (WebCrypto).
 * The platform keeps nothing between showing the form and reading it back,
 * and a form it did not make, or made more than ten minutes ago, is refused.
 */
import { Clock, Data, Duration, Effect, Redacted, Schema } from "effect";

/**
 * The provider's `AuthRequest`, as `parseAuthRequest` returned it: the
 * client, where its code goes, its PKCE challenge, and the resource and
 * issuer the provider recorded. The provider writes an absent challenge as
 * `undefined`, so the optional keys take it (internal JSON, never a wire
 * schema).
 */
export const AuthRequest = Schema.Struct({
  clientId: Schema.String,
  codeChallenge: Schema.optional(Schema.String),
  codeChallengeMethod: Schema.optional(Schema.String),
  issuer: Schema.optional(Schema.String),
  redirectUri: Schema.String,
  resource: Schema.optional(Schema.String),
  responseType: Schema.String,
  scope: Schema.Array(Schema.String),
  state: Schema.String,
});

export type AuthRequest = typeof AuthRequest.Type;

/** What the form carries: the OAuth request, and the CSRF token its cookie must match. */
export const PendingSignIn = Schema.Struct({
  csrf: Schema.String,
  request: AuthRequest,
});

export type PendingSignIn = typeof PendingSignIn.Type;

/** How long a sign-in form stays good. */
export const SIGN_IN_LIFETIME = Duration.minutes(10);

const Signature = Schema.Uint8ArrayFromBase64Url;

const encodeSignature = Schema.encodeEffect(Signature);

const decodeSignature = Schema.decodeEffect(Signature);

/**
 * Signing in did not go through, for a reason the person sees as a plain
 * sentence on the page. Internal to `auth/`: never a contract refusal.
 */
export class SignInFailed extends Data.TaggedError("SignInFailed")<{
  readonly reason: string;
  /**
   * The client's own error redirect, set only when the provider validated
   * the client and its redirect URI (`AuthorizationError.redirectTo`).
   */
  readonly redirectTo?: string;
}> {}

/** The one thing a person can do with a form that is stale, forged or from another browser. */
export const startAgain = new SignInFailed({
  reason:
    "This sign-in page expired or was not opened here. Start signing in again from your app.",
});

const utf8 = (text: string) => new TextEncoder().encode(text);

/** `COOKIE_KEY` as an HMAC-SHA-256 key. */
const hmacKey = (key: Redacted.Redacted) =>
  Effect.promise(() =>
    crypto.subtle.importKey(
      "raw",
      utf8(Redacted.value(key)),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign", "verify"]
    )
  );

/**
 * Seals and opens one kind of value carried through the browser: as
 * `<payload>.<signature>`, the payload base64url JSON of the value and when
 * it stops being good (ten minutes on), signed under `COOKIE_KEY` together
 * with `purpose`. A value this platform did not seal, sealed for another
 * purpose (however its shape fits: a schema ignores extra keys), or sealed
 * too long ago, opens to `startAgain`.
 */
export const sealing = <A, I>(purpose: string, schema: Schema.Codec<A, I>) => {
  /** What the signature covers: the purpose, then the payload. */
  const signed = (payload: string) => utf8(`${purpose}.${payload}`);

  const Payload = Schema.StringFromBase64Url.pipe(
    Schema.decodeTo(
      Schema.fromJsonString(
        Schema.Struct({ expiresAt: Schema.Int, value: schema })
      )
    )
  );

  const encodePayload = Schema.encodeEffect(Payload);

  const decodePayload = Schema.decodeEffect(Payload);

  /** `value`, good for ten minutes from now. */
  const seal = (key: Redacted.Redacted, value: A) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;

      const payload = yield* encodePayload({
        expiresAt: now + Duration.toMillis(SIGN_IN_LIFETIME),
        value,
      }).pipe(Effect.orDie);

      const hmac = yield* hmacKey(key);

      const signature = yield* Effect.promise(() =>
        crypto.subtle.sign("HMAC", hmac, signed(payload))
      );

      return `${payload}.${yield* encodeSignature(new Uint8Array(signature)).pipe(Effect.orDie)}`;
    });

  /**
   * What `sealed` carries, if this platform sealed it with `key` (checked
   * in constant time by WebCrypto) and its ten minutes have not passed.
   */
  const open = (key: Redacted.Redacted, sealed: string) =>
    Effect.gen(function* () {
      const [payload = "", encoded = ""] = sealed.split(".");

      const signature = yield* decodeSignature(encoded).pipe(
        Effect.mapError(() => startAgain)
      );

      const hmac = yield* hmacKey(key);

      const genuine = yield* Effect.promise(() =>
        crypto.subtle.verify(
          "HMAC",
          hmac,
          new Uint8Array(signature),
          signed(payload)
        )
      );

      if (!genuine) {
        return yield* startAgain;
      }

      const { expiresAt, value } = yield* decodePayload(payload).pipe(
        Effect.mapError(() => startAgain)
      );

      const now = yield* Clock.currentTimeMillis;

      if (now >= expiresAt) {
        return yield* startAgain;
      }

      return value;
    });

  return { open, seal };
};

const pendingSignIns = sealing("sign-in", PendingSignIn);

/** `pending`, good for ten minutes from now, as `<payload>.<signature>`. */
export const sealState = pendingSignIns.seal;

/**
 * What `sealed` carries, if this platform sealed it with `key` (checked in
 * constant time by WebCrypto) and its ten minutes have not passed.
 */
export const openState = pendingSignIns.open;
