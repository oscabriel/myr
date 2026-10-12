import { Clock, Data, Duration, Effect, Redacted, Schema } from "effect";

// The provider writes an absent challenge as `undefined`, so these keys are `optional` (internal JSON, never a wire schema).
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

export const PendingSignIn = Schema.Struct({
  csrf: Schema.String,
  request: AuthRequest,
});

export type PendingSignIn = typeof PendingSignIn.Type;

export const SIGN_IN_LIFETIME = Duration.minutes(10);

const Signature = Schema.Uint8ArrayFromBase64Url;

const encodeSignature = Schema.encodeEffect(Signature);

const decodeSignature = Schema.decodeEffect(Signature);

export class SignInFailed extends Data.TaggedError("SignInFailed")<{
  readonly reason: string;
  // Set only once the provider validated the client and its redirect URI.
  readonly redirectTo?: string;
}> {}

export const startAgain = new SignInFailed({
  reason:
    "This sign-in page expired or was not opened here. Start signing in again from your app.",
});

const utf8 = (text: string) => new TextEncoder().encode(text);

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

// The signature covers `purpose` too: a schema ignores extra keys, so a value sealed for another purpose must not open.
export const sealing = <A, I>(purpose: string, schema: Schema.Codec<A, I>) => {
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

export const sealState = pendingSignIns.seal;

export const openState = pendingSignIns.open;
