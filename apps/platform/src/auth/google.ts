// Google's stable subject id (`sub`) is what links an account. Its email is
// taken only when Google says it verified it, and its name only to fill in
// the profile form; no Google token is kept after the exchange.
import { Fetch } from "@repo/artifacts/fetch";
import { Handle } from "@repo/protocol/ids";
import {
  Array,
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Ref,
  Result,
  Schema,
} from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { Accounts, Email } from "./accounts.ts";
import type { Account } from "./accounts.ts";
import { SignInAttempts } from "./attempts.ts";
import { Identities } from "./identities.ts";
import { Mailer } from "./mailer.ts";
import { OAuthStore } from "./oauth-store.ts";
import { GOOGLE_PATHS, profilePage } from "./pages.ts";
import type { ProfileValues } from "./pages.ts";
import { hashPassword } from "./password.ts";
import {
  addEmailPageFor,
  addressOf,
  askerOf,
  Authorization,
  authorizeHref,
  byPassword,
  chosenDisplayName,
  chosenHandle,
  completed,
  csrfCookieName,
  csrfOf,
  csrfCookie,
  failedPage,
  freshCsrf,
  HeldHandles,
  htmlPage,
  Says,
  SignInKeys,
  SignInHome,
  SignInOffers,
  signInPageFor,
} from "./sign-in.ts";
import type { SignInServices } from "./sign-in.ts";
import {
  AuthRequest,
  openState,
  sealing,
  SIGN_IN_LIFETIME,
  SignInFailed,
  startAgain,
} from "./state.ts";

export const GOOGLE_ACCOUNTS = "https://accounts.google.com";

export const GOOGLE_DISCOVERY = `${GOOGLE_ACCOUNTS}/.well-known/openid-configuration`;

const AUTHORIZE_ENDPOINT = `${GOOGLE_ACCOUNTS}/o/oauth2/v2/auth`;

const ISSUERS: ReadonlySet<string> = new Set([
  GOOGLE_ACCOUNTS,
  "accounts.google.com",
]);

export const GoogleSubject = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(255)
).pipe(Schema.brand("GoogleSubject"));

export type GoogleSubject = typeof GoogleSubject.Type;

// Said the same way whatever the cause.
const unconfirmed = new SignInFailed({
  reason:
    "Google did not confirm who you are. Try again, or sign in with your password.",
});

export const googleAuthorizeUrl = (input: {
  readonly clientId: string;
  readonly codeChallenge: string;
  readonly nonce: string;
  readonly redirectUri: string;
  readonly state: string;
}) => {
  const url = new URL(AUTHORIZE_ENDPOINT);

  url.search = new URLSearchParams({
    client_id: input.clientId,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    nonce: input.nonce,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
  }).toString();

  return url.toString();
};

const Discovery = Schema.Struct({
  jwks_uri: Schema.String,
  token_endpoint: Schema.String,
});

type Discovery = typeof Discovery.Type;

const SigningKey = Schema.Struct({
  alg: Schema.optionalKey(Schema.Literal("RS256")),
  e: Schema.String,
  kid: Schema.String,
  kty: Schema.Literal("RSA"),
  n: Schema.String,
  use: Schema.optionalKey(Schema.Literal("sig")),
});

const decodeSigningKey = Schema.decodeUnknownOption(SigningKey);

const KeySet = Schema.Struct({ keys: Schema.Array(Schema.Unknown) });

const TokenResponse = Schema.Struct({ id_token: Schema.String });

const Header = Schema.Struct({
  alg: Schema.Literal("RS256"),
  kid: Schema.String,
});

const Claims = Schema.Struct({
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  azp: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  email_verified: Schema.optionalKey(Schema.Boolean),
  exp: Schema.Finite,
  iss: Schema.String,
  name: Schema.optionalKey(Schema.String),
  nonce: Schema.optionalKey(Schema.String),
  sub: GoogleSubject,
});

export interface GooglePerson {
  // Only an address Google verified.
  readonly email: Option.Option<Email>;
  readonly name: Option.Option<string>;
  readonly subject: GoogleSubject;
}

const decodeEmail = Schema.decodeUnknownOption(Email);

const personOf = (claims: typeof Claims.Type): GooglePerson => ({
  email: Option.fromUndefinedOr(claims.email).pipe(
    Option.filter(() => claims.email_verified === true),
    Option.flatMap(decodeEmail)
  ),
  name: Option.fromUndefinedOr(claims.name),
  subject: claims.sub,
});

const segment = <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  Schema.decodeEffect(
    Schema.StringFromBase64Url.pipe(
      Schema.decodeTo(Schema.fromJsonString(schema))
    )
  );

const decodeHeader = segment(Header);

const decodeClaims = segment(Claims);

const decodeSignature = Schema.decodeEffect(Schema.Uint8ArrayFromBase64Url);

const RSA = { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" } as const;

const utf8 = (text: string) => new TextEncoder().encode(text);

const answerOf = <A>(
  fetch: Fetch["Service"],
  schema: Schema.Codec<A, unknown>,
  request: Request
) =>
  Effect.gen(function* () {
    const response = yield* fetch
      .fetch(request)
      .pipe(Effect.mapError(() => unconfirmed));

    const text = yield* Effect.tryPromise({
      catch: () => unconfirmed,
      try: () => response.text(),
    });

    if (!response.ok) {
      return yield* unconfirmed;
    }

    return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(
      Effect.mapError(() => unconfirmed)
    );
  });

const imported = (key: typeof SigningKey.Type) =>
  Effect.tryPromise(() =>
    crypto.subtle.importKey(
      "jwk",
      { alg: "RS256", e: key.e, ext: true, kty: "RSA", n: key.n },
      RSA,
      false,
      ["verify"]
    )
  ).pipe(
    Effect.map((verifier) => Option.some([key.kid, verifier] as const)),
    Effect.orElseSucceed(() => Option.none())
  );

// Keys are read again when an ID token names one not kept (Google rotates them); only a success is kept.
export class GoogleKeys extends Context.Service<
  GoogleKeys,
  {
    readonly discovery: Effect.Effect<Discovery, SignInFailed>;
    readonly key: (kid: string) => Effect.Effect<CryptoKey, SignInFailed>;
  }
>()("platform/GoogleKeys") {}

export const GoogleKeysPerIsolate = Layer.effect(
  GoogleKeys,
  Effect.gen(function* () {
    const fetch = yield* Fetch;

    const kept = yield* Ref.make(Option.none<Discovery>());

    const keys = yield* Ref.make<ReadonlyMap<string, CryptoKey>>(new Map());

    const discovery = Effect.gen(function* () {
      const known = yield* Ref.get(kept);

      if (Option.isSome(known)) {
        return known.value;
      }

      const read = yield* answerOf(
        fetch,
        Discovery,
        new Request(GOOGLE_DISCOVERY)
      );

      yield* Ref.set(kept, Option.some(read));

      return read;
    });

    const fetchKeys = Effect.gen(function* () {
      const { jwks_uri } = yield* discovery;

      const set = yield* answerOf(fetch, KeySet, new Request(jwks_uri));

      const fresh = new Map(
        Array.getSomes(
          yield* Effect.forEach(
            Array.getSomes(set.keys.map((key) => decodeSigningKey(key))),
            imported
          )
        )
      );

      yield* Ref.set(keys, fresh);

      return fresh;
    });

    return GoogleKeys.of({
      discovery,
      key: (kid) =>
        Effect.gen(function* () {
          const known = (yield* Ref.get(keys)).get(kid);

          if (known !== undefined) {
            return known;
          }

          const fresh = yield* fetchKeys;

          return yield* Effect.fromNullishOr(fresh.get(kid)).pipe(
            Effect.mapError(() => unconfirmed)
          );
        }),
    });
  })
);

const issuedTo = (claims: typeof Claims.Type, clientId: string) => {
  const audience = Predicate.isString(claims.aud) ? [claims.aud] : claims.aud;

  return (
    audience.includes(clientId) &&
    (claims.azp ?? clientId) === clientId &&
    (audience.length === 1 || claims.azp === clientId)
  );
};

const verifiedPerson = (
  token: string,
  expected: { readonly clientId: string; readonly nonce: string }
) =>
  Effect.gen(function* () {
    const keys = yield* GoogleKeys;

    const [header = "", claims = "", signature = "", ...rest] =
      token.split(".");

    if (rest.length > 0) {
      return yield* unconfirmed;
    }

    const { kid } = yield* decodeHeader(header).pipe(
      Effect.mapError(() => unconfirmed)
    );

    const key = yield* keys.key(kid);

    const signed = yield* decodeSignature(signature).pipe(
      Effect.mapError(() => unconfirmed)
    );

    const genuine = yield* Effect.promise(() =>
      crypto.subtle.verify(
        RSA,
        key,
        new Uint8Array(signed),
        utf8(`${header}.${claims}`)
      )
    );

    if (!genuine) {
      return yield* unconfirmed;
    }

    const said = yield* decodeClaims(claims).pipe(
      Effect.mapError(() => unconfirmed)
    );

    const now = yield* Clock.currentTimeMillis;

    const holds =
      ISSUERS.has(said.iss) &&
      issuedTo(said, expected.clientId) &&
      said.exp * 1000 > now &&
      said.nonce === expected.nonce;

    return holds ? personOf(said) : yield* unconfirmed;
  });

// Google's other tokens in the answer are never read, and nothing of it is kept.
export const googlePerson = (input: {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly code: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
}): Effect.Effect<GooglePerson, SignInFailed, Fetch | GoogleKeys> =>
  Effect.gen(function* () {
    const keys = yield* GoogleKeys;

    const fetch = yield* Fetch;

    const { token_endpoint } = yield* keys.discovery;

    const { id_token } = yield* answerOf(
      fetch,
      TokenResponse,
      new Request(token_endpoint, {
        body: new URLSearchParams({
          client_id: input.clientId,
          client_secret: Redacted.value(input.clientSecret),
          code: input.code,
          code_verifier: input.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: input.redirectUri,
        }),
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      })
    );

    return yield* verifiedPerson(id_token, input);
  });

interface Client {
  readonly id: string;
  readonly secret: Redacted.Redacted;
}

export class GoogleClient extends Context.Service<
  GoogleClient,
  { readonly client: Option.Option<Client> }
>()("platform/GoogleClient") {}

const GoogleSays = {
  linkedElsewhere:
    "That Google account is linked to another handle. Sign in with that handle, or use another Google account.",
  noEmail:
    "Google did not share a verified email for that account. Sign up with an email and password instead.",
} as const;

// `SameSite=Lax`: Google's redirect back is a cross-site top-level navigation, which a `Strict` cookie misses.
const GOOGLE_COOKIE = "__Host-google-sign-in";

const googleCookie = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: true,
} as const;

const legDone = (response: HttpServerResponse.HttpServerResponse) =>
  response.pipe(
    HttpServerResponse.setCookie(GOOGLE_COOKIE, "", {
      ...googleCookie,
      maxAge: 0,
    }),
    Effect.orDie
  );

// Carries the challenge of the verifier in this browser's cookie, so only this browser finishes the leg.
const GoogleLeg = Schema.Struct({
  challenge: Schema.String,
  link: Schema.optionalKey(Handle),
  nonce: Schema.String,
  request: AuthRequest,
});

const legs = sealing("google-leg", GoogleLeg);

const PendingHandle = Schema.Struct({
  csrf: Schema.String,
  email: Email,
  name: Schema.optionalKey(Schema.String),
  request: AuthRequest,
  subject: GoogleSubject,
});

type PendingHandle = typeof PendingHandle.Type;

const pendingHandles = sealing("google-handle", PendingHandle);

const encodeBytes = Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url);

const freshSecret = Effect.sync(() =>
  crypto.getRandomValues(new Uint8Array(32))
).pipe(Effect.flatMap(encodeBytes), Effect.orDie);

const challengeOf = (verifier: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", utf8(verifier))).pipe(
    Effect.flatMap((digest) => encodeBytes(new Uint8Array(digest))),
    Effect.orDie
  );

const callbackUri = (origin: string) => `${origin}${GOOGLE_PATHS.callback}`;

const toGoogle = (
  client: Client,
  request: AuthRequest,
  link: Option.Option<Handle>
) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const { origin } = yield* Authorization;

    const verifier = yield* freshSecret;

    const nonce = yield* freshSecret;

    const challenge = yield* challengeOf(verifier);

    const leg = { challenge, nonce, request };

    const state = yield* legs.seal(
      cookieKey,
      Option.match(link, {
        onNone: () => leg,
        onSome: (handle) => ({ ...leg, link: handle }),
      })
    );

    return yield* HttpServerResponse.redirect(
      googleAuthorizeUrl({
        clientId: client.id,
        codeChallenge: challenge,
        nonce,
        redirectUri: callbackUri(origin),
        state,
      }),
      {
        headers: {
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
        status: 302,
      }
    ).pipe(
      HttpServerResponse.setCookie(GOOGLE_COOKIE, verifier, {
        ...googleCookie,
        maxAge: SIGN_IN_LIFETIME,
      }),
      Effect.orDie
    );
  });

const start =
  (client: Client) => (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const { cookieKey } = yield* SignInKeys;

      const { request: sealed } = yield* HttpServerRequest.schemaSearchParams(
        Schema.Struct({ request: Schema.String })
      ).pipe(Effect.mapError(() => startAgain));

      const pending = yield* openState(cookieKey, sealed);

      if (csrfOf(request, pending.csrf) !== pending.csrf) {
        return yield* startAgain;
      }

      return yield* toGoogle(client, pending.request, Option.none());
    });

const link =
  (client: Client) => (request: HttpServerRequest.HttpServerRequest) =>
    byPassword(request, (account, pending) =>
      toGoogle(client, pending.request, Option.some(account.handle))
    );

const pickHandle = (
  pending: Omit<PendingHandle, "csrf">,
  values: ProfileValues,
  status: number,
  message?: string
) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const csrf = yield* freshCsrf;

    const sealed = yield* pendingHandles.seal(cookieKey, { ...pending, csrf });

    const asker = yield* askerOf(pending.request);

    return yield* htmlPage(
      profilePage(
        asker,
        { csrf, request: sealed },
        authorizeHref(pending.request),
        values,
        message
      ),
      status,
      pending.request.redirectUri
    ).pipe(
      HttpServerResponse.setCookie(csrfCookieName(csrf), csrf, {
        ...csrfCookie,
        maxAge: SIGN_IN_LIFETIME,
      }),
      Effect.orDie
    );
  });

// Google just proved who the person is, so an account without an email
// takes Google's verified one; if it has none, or another account holds it,
// the person adds one before the grant, as a password sign-in would.
const completedWithEmail = (
  account: Account,
  person: GooglePerson,
  request: AuthRequest
) =>
  Effect.gen(function* () {
    const accounts = yield* Accounts;

    if (account.email !== undefined) {
      return yield* completed(account.handle, request);
    }

    const set = yield* Option.match(person.email, {
      onNone: () => Effect.succeed(false),
      onSome: (email) =>
        accounts.setEmail(account.handle, email).pipe(
          Effect.as(true),
          Effect.catchTag("EmailTaken", () => Effect.succeed(false))
        ),
    });

    return yield* set
      ? completed(account.handle, request)
      : addEmailPageFor(account.handle, request, 200);
  });

const linkedTo = (person: GooglePerson, handle: Handle, request: AuthRequest) =>
  Effect.gen(function* () {
    const identities = yield* Identities;

    const accounts = yield* Accounts;

    const linked = yield* identities
      .link("google", person.subject, handle)
      .pipe(
        Effect.as(true),
        Effect.catchTag("IdentityTaken", () => Effect.succeed(false))
      );

    if (!linked) {
      return yield* signInPageFor(request, 409, GoogleSays.linkedElsewhere);
    }

    const account = yield* accounts.find(handle);

    return yield* Option.match(account, {
      onNone: () => signInPageFor(request, 401, unconfirmed.reason),
      onSome: (found) => completedWithEmail(found, person, request),
    });
  });

const signedInAs = (person: GooglePerson, request: AuthRequest) =>
  Effect.gen(function* () {
    const identities = yield* Identities;

    const accounts = yield* Accounts;

    const linked = yield* identities.handleOf("google", person.subject);

    if (Option.isSome(linked)) {
      const account = yield* accounts.find(linked.value);

      return yield* Option.match(account, {
        onNone: () => signInPageFor(request, 401, unconfirmed.reason),
        onSome: (found) => completedWithEmail(found, person, request),
      });
    }

    if (Option.isNone(person.email)) {
      return yield* signInPageFor(request, 401, GoogleSays.noEmail);
    }

    // Both Google and the account proved the address, so they are one person.
    const holder = yield* accounts.findByEmail(person.email.value);

    if (Option.isSome(holder)) {
      return yield* linkedTo(person, holder.value.handle, request);
    }

    return yield* pickHandle(
      {
        email: person.email.value,
        request,
        subject: person.subject,
        ...Option.match(person.name, {
          onNone: () => ({}),
          onSome: (name) => ({ name }),
        }),
      },
      Option.match(person.name, {
        onNone: () => ({}),
        onSome: (displayName) => ({ displayName }),
      }),
      200
    );
  });

const CallbackQuery = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  state: Schema.String,
});

const cameBack =
  (client: Client) => (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const { cookieKey } = yield* SignInKeys;

      const { origin } = yield* Authorization;

      const query = yield* HttpServerRequest.schemaSearchParams(
        CallbackQuery
      ).pipe(Effect.mapError(() => startAgain));

      const leg = yield* legs.open(cookieKey, query.state);

      const verifier = request.cookies[GOOGLE_COOKIE] ?? "";

      if ((yield* challengeOf(verifier)) !== leg.challenge) {
        return yield* startAgain;
      }

      const confirmed = yield* Option.match(
        Option.fromUndefinedOr(query.code),
        {
          // Google sends `error` and no code when the person declines.
          onNone: () => Effect.fail(unconfirmed),
          onSome: (code) =>
            googlePerson({
              clientId: client.id,
              clientSecret: client.secret,
              code,
              codeVerifier: verifier,
              nonce: leg.nonce,
              redirectUri: callbackUri(origin),
            }),
        }
      ).pipe(Effect.result);

      if (Result.isFailure(confirmed)) {
        return yield* signInPageFor(
          leg.request,
          401,
          confirmed.failure.reason
        ).pipe(Effect.flatMap(legDone));
      }

      const answered = yield* Option.match(Option.fromUndefinedOr(leg.link), {
        onNone: () => signedInAs(confirmed.success, leg.request),
        onSome: (handle) => linkedTo(confirmed.success, handle, leg.request),
      });

      return yield* legDone(answered);
    });

const PostedProfile = Schema.Struct({
  csrf: Schema.String,
  displayName: Schema.String,
  handle: Schema.String,
  request: Schema.String,
});

// The account's password is one nobody is told: Google signs it in, and a
// reset by its email sets a real one.
const handleChosen = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey, pepper } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const identities = yield* Identities;

    const attempts = yield* SignInAttempts;

    const { handles: held } = yield* HeldHandles;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(
      PostedProfile
    ).pipe(Effect.mapError(() => startAgain));

    const pending = yield* pendingHandles.open(cookieKey, form.request);

    if (
      pending.csrf !== form.csrf ||
      csrfOf(request, form.csrf) !== form.csrf
    ) {
      return yield* startAgain;
    }

    const person: GooglePerson = {
      email: Option.some(pending.email),
      name: Option.fromUndefinedOr(pending.name),
      subject: pending.subject,
    };

    const again = (status: number, message: string) =>
      pickHandle(
        pending,
        { displayName: form.displayName, handle: form.handle },
        status,
        message
      );

    if (!(yield* attempts.admit(`sign-up:${addressOf(request)}`))) {
      return yield* again(429, Says.tooManySignUps);
    }

    if (Option.isSome(yield* identities.handleOf("google", pending.subject))) {
      return yield* signedInAs(person, pending.request);
    }

    const checked = Result.all({
      displayName: chosenDisplayName(form.displayName),
      handle: chosenHandle(form.handle, held),
    });

    if (Result.isFailure(checked)) {
      return yield* again(checked.failure.status, checked.failure.message);
    }

    const hash = yield* hashPassword(pepper, Redacted.make(yield* freshSecret));

    return yield* accounts
      .create({
        displayName: checked.success.displayName,
        email: pending.email,
        handle: checked.success.handle,
        hash,
      })
      .pipe(
        Effect.andThen(
          linkedTo(person, checked.success.handle, pending.request)
        ),
        Effect.catchTags({
          // Someone proved the same address since: they are one person.
          EmailTaken: () => signedInAs(person, pending.request),
          HandleTaken: () => again(409, Says.handleTaken),
        })
      );
  });

export type GoogleServices = Fetch | GoogleClient | Identities | SignInServices;

export const googleRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const { client } = yield* GoogleClient;

    if (Option.isNone(client)) {
      return;
    }

    const services = Context.make(Accounts, yield* Accounts).pipe(
      Context.add(Fetch, yield* Fetch),
      Context.add(GoogleKeys, yield* GoogleKeys),
      Context.add(HeldHandles, yield* HeldHandles),
      Context.add(Identities, yield* Identities),
      Context.add(Mailer, yield* Mailer),
      Context.add(OAuthStore, yield* OAuthStore),
      Context.add(SignInAttempts, yield* SignInAttempts),
      Context.add(SignInHome, yield* SignInHome),
      Context.add(SignInKeys, yield* SignInKeys),
      Context.add(SignInOffers, yield* SignInOffers)
    );

    const add = <R>(
      method: "GET" | "POST",
      path: HttpRouter.PathInput,
      handler: (
        request: HttpServerRequest.HttpServerRequest
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse, SignInFailed, R>
    ) =>
      router.add(method, path, (request) =>
        handler(request).pipe(
          Effect.catchTag("SignInFailed", failedPage),
          Effect.provide(services)
        )
      );

    yield* add("GET", GOOGLE_PATHS.start, start(client.value));
    yield* add("POST", GOOGLE_PATHS.link, link(client.value));
    yield* add("GET", GOOGLE_PATHS.callback, cameBack(client.value));
    yield* add("POST", GOOGLE_PATHS.handle, handleChosen);
  })
).pipe(Layer.provide(GoogleKeysPerIsolate));
