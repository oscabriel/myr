/**
 * Google sign-in (issue 419): a second way to prove who you are, beside a
 * password, offered only when the platform has a Google OAuth client
 * (`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; human step H4).
 *
 * The first half is Google's OpenID Connect client: the authorization
 * request (a code, `openid` only, PKCE by S256, a nonce), the code exchange
 * at the token endpoint, and the ID token's check, by WebCrypto against
 * Google's published keys. All of it goes through the `Fetch` port. The
 * person is Google's stable subject id (`sub`) alone: no email, no name,
 * and no Google token is kept after the exchange.
 *
 * The second half is its routes beside sign-in's own (`sign-in.ts`):
 * "Continue with Google" from the sign-in page, Google's redirect back, the
 * handle a first Google sign-in chooses (sign-up's rules), and linking
 * Google to an account signed in by password. Each ends as a password
 * sign-in does: the client gets a code for a token whose props are only
 * `{ handle }`. A known subject goes straight to its handle; links live
 * behind the `Identities` port.
 */
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

import { Accounts } from "./accounts.ts";
import { SignInAttempts } from "./attempts.ts";
import { Identities } from "./identities.ts";
import { OAuthStore } from "./oauth-store.ts";
import { GOOGLE_PATHS, pickHandlePage } from "./pages.ts";
import { hashPassword } from "./password.ts";
import {
  addressOf,
  askerOf,
  Authorization,
  authorizeHref,
  byPassword,
  chosenHandle,
  completed,
  CSRF_COOKIE,
  csrfCookie,
  failedPage,
  freshCsrf,
  HeldHandles,
  htmlPage,
  Says,
  SignInKeys,
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

/** Google's sign-in origin: where the authorization request sends a person. */
export const GOOGLE_ACCOUNTS = "https://accounts.google.com";

/** Google's discovery document: its token endpoint and where its keys are. */
export const GOOGLE_DISCOVERY = `${GOOGLE_ACCOUNTS}/.well-known/openid-configuration`;

const AUTHORIZE_ENDPOINT = `${GOOGLE_ACCOUNTS}/o/oauth2/v2/auth`;

/** The two spellings of Google's issuer an ID token may carry. */
const ISSUERS: ReadonlySet<string> = new Set([
  GOOGLE_ACCOUNTS,
  "accounts.google.com",
]);

/**
 * The person as Google knows them: unique among Google accounts, never
 * reused, at most 255 ASCII characters.
 */
export const GoogleSubject = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(255)
).pipe(Schema.brand("GoogleSubject"));

export type GoogleSubject = typeof GoogleSubject.Type;

/** Signing in with Google did not confirm anyone, said the same way whatever the cause. */
const unconfirmed = new SignInFailed({
  reason:
    "Google did not confirm who you are. Try again, or sign in with your password.",
});

/**
 * Where Google's authorization request sends the browser: a code, scope
 * `openid` only, the PKCE challenge (S256), the platform's sealed `state`,
 * and a `nonce` the ID token must carry back.
 */
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
    scope: "openid",
    state: input.state,
  }).toString();

  return url.toString();
};

/** What the platform reads from Google's discovery document. */
const Discovery = Schema.Struct({
  jwks_uri: Schema.String,
  token_endpoint: Schema.String,
});

type Discovery = typeof Discovery.Type;

/** One RS256 signing key in Google's JWKS; any other key is skipped. */
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

/** What the token endpoint answers, as far as the platform reads it: only the ID token. */
const TokenResponse = Schema.Struct({ id_token: Schema.String });

/** An ID token's header: RS256 only, and the key it names. */
const Header = Schema.Struct({
  alg: Schema.Literal("RS256"),
  kid: Schema.String,
});

/** The claims the platform checks; the rest are never read. */
const Claims = Schema.Struct({
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  azp: Schema.optionalKey(Schema.String),
  exp: Schema.Finite,
  iss: Schema.String,
  nonce: Schema.optionalKey(Schema.String),
  sub: GoogleSubject,
});

/** A JWT segment: base64url of JSON. */
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

/** `request`'s answer as `schema`, or nobody confirmed: no answer, not 2xx, or not the shape. */
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

/** `key` as a WebCrypto RS256 verification key, or none if it does not import. */
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

/**
 * Google's endpoints and signing keys, kept for the isolate's life: the
 * discovery document is read once, and the keys by `kid` once, then read
 * again once whenever an ID token names a key not kept (Google rotates
 * them). Only a success is kept.
 */
export class GoogleKeys extends Context.Service<
  GoogleKeys,
  {
    readonly discovery: Effect.Effect<Discovery, SignInFailed>;
    readonly key: (kid: string) => Effect.Effect<CryptoKey, SignInFailed>;
  }
>()("platform/GoogleKeys") {}

/**
 * `GoogleKeys` over `Fetch`, empty until first used. The sign-in routes
 * build it once, with the router, so it lives as long as the isolate.
 */
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

/** Whether the token was issued to this client: its audience, and its authorized party when named. */
const issuedTo = (claims: typeof Claims.Type, clientId: string) => {
  const audience = Predicate.isString(claims.aud) ? [claims.aud] : claims.aud;

  return (
    audience.includes(clientId) &&
    (claims.azp ?? clientId) === clientId &&
    (audience.length === 1 || claims.azp === clientId)
  );
};

/**
 * The subject of `token`, if Google signed it (RS256, a key from its JWKS)
 * for this client, it has not expired, and it carries `nonce`.
 */
const verifiedSubject = (
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

    return holds ? said.sub : yield* unconfirmed;
  });

/**
 * The person Google confirms for `code`: the code is exchanged at Google's
 * token endpoint (with the client's secret and the PKCE verifier), and the
 * ID token in the answer is checked. Google's other tokens in the answer
 * are never read, and nothing of the answer is kept.
 */
export const googleSubject = (input: {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly code: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
}): Effect.Effect<GoogleSubject, SignInFailed, Fetch | GoogleKeys> =>
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

    return yield* verifiedSubject(id_token, input);
  });

/** A Google OAuth client: its id, and its secret. */
interface Client {
  readonly id: string;
  readonly secret: Redacted.Redacted;
}

/** The platform's Google OAuth client, when it has one: Google sign-in is offered only then. */
export class GoogleClient extends Context.Service<
  GoogleClient,
  { readonly client: Option.Option<Client> }
>()("platform/GoogleClient") {}

/** What a Google sign-in's pages say, besides sign-in's own sentences. */
const GoogleSays = {
  linkedElsewhere:
    "That Google account is linked to another handle. Sign in with that handle, or use another Google account.",
} as const;

/**
 * The cookie Google's leg keeps its PKCE verifier in, so the verifier
 * never travels in a URL. `SameSite=Lax`: Google's redirect back is a
 * top-level navigation from another site, which a `Strict` cookie misses.
 */
const GOOGLE_COOKIE = "__Host-google-sign-in";

const googleCookie = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: true,
} as const;

/** Google's leg is over: its cookie goes. */
const legDone = (response: HttpServerResponse.HttpServerResponse) =>
  response.pipe(
    HttpServerResponse.setCookie(GOOGLE_COOKIE, "", {
      ...googleCookie,
      maxAge: 0,
    }),
    Effect.orDie
  );

/**
 * Google's leg of a sign-in, sealed with `COOKIE_KEY` into the `state`
 * Google sends back: the sign-in it continues, the S256 challenge of the
 * verifier in this browser's cookie (so only this browser finishes it),
 * the nonce the ID token must carry, and the handle to link Google to when
 * a person signed in by password asked to link it.
 */
const GoogleLeg = Schema.Struct({
  challenge: Schema.String,
  link: Schema.optionalKey(Handle),
  nonce: Schema.String,
  request: AuthRequest,
});

const legs = sealing(GoogleLeg);

/**
 * A first Google sign-in waiting for its handle, sealed into the form that
 * chooses it: the person Google confirmed, the sign-in it continues, and
 * the form's CSRF token.
 */
const PendingHandle = Schema.Struct({
  csrf: Schema.String,
  request: AuthRequest,
  subject: GoogleSubject,
});

const pendingHandles = sealing(PendingHandle);

const encodeBytes = Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url);

/**
 * 32 fresh random bytes, base64url: a PKCE verifier (43 characters, RFC
 * 7636), a nonce, or a password nobody is ever told.
 */
const freshSecret = Effect.sync(() =>
  crypto.getRandomValues(new Uint8Array(32))
).pipe(Effect.flatMap(encodeBytes), Effect.orDie);

/** The S256 challenge of a PKCE verifier: its SHA-256, base64url. */
const challengeOf = (verifier: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", utf8(verifier))).pipe(
    Effect.flatMap((digest) => encodeBytes(new Uint8Array(digest))),
    Effect.orDie
  );

/** Where Google sends the browser back: this origin's callback, as H4 registers it. */
const callbackUri = (origin: string) => `${origin}${GOOGLE_PATHS.callback}`;

/**
 * To Google, for the sign-in `request` continues: a fresh PKCE verifier in
 * this browser's cookie, and the leg sealed as the `state`.
 */
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

/**
 * `GET /oauth/google/start?request=<sealed>`: "Continue with Google" from
 * the sign-in page this browser opened (its CSRF cookie matches the seal),
 * to Google.
 */
const start =
  (client: Client) => (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const { cookieKey } = yield* SignInKeys;

      const { request: sealed } = yield* HttpServerRequest.schemaSearchParams(
        Schema.Struct({ request: Schema.String })
      ).pipe(Effect.mapError(() => startAgain));

      const pending = yield* openState(cookieKey, sealed);

      if (request.cookies[CSRF_COOKIE] !== pending.csrf) {
        return yield* startAgain;
      }

      return yield* toGoogle(client, pending.request, Option.none());
    });

/**
 * `POST /oauth/google/link`: "Sign in and link Google". Signed in by handle
 * and password first (sign-in's checks and limits), then to Google, to link
 * the Google account to that handle.
 */
const link =
  (client: Client) => (request: HttpServerRequest.HttpServerRequest) =>
    byPassword(request, (handle, pending) =>
      toGoogle(client, pending.request, Option.some(handle))
    );

/** The page to choose a handle on, for the person Google confirmed. */
const pickHandle = (
  subject: GoogleSubject,
  request: AuthRequest,
  status: number,
  message?: string
) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const csrf = yield* freshCsrf;

    const sealed = yield* pendingHandles.seal(cookieKey, {
      csrf,
      request,
      subject,
    });

    const asker = yield* askerOf(request);

    return yield* htmlPage(
      pickHandlePage(
        asker,
        { csrf, request: sealed },
        authorizeHref(request),
        message
      ),
      status,
      request.redirectUri
    ).pipe(
      HttpServerResponse.setCookie(CSRF_COOKIE, csrf, {
        ...csrfCookie,
        maxAge: SIGN_IN_LIFETIME,
      }),
      Effect.orDie
    );
  });

/**
 * The person Google confirmed: back to the client as the handle their
 * subject is linked to, or, the first time, the page to choose one. A link
 * whose account is gone names nobody.
 */
const signedInAs = (subject: GoogleSubject, request: AuthRequest) =>
  Effect.gen(function* () {
    const identities = yield* Identities;

    const accounts = yield* Accounts;

    const linked = yield* identities.handleOf("google", subject);

    if (Option.isNone(linked)) {
      return yield* pickHandle(subject, request, 200);
    }

    const account = yield* accounts.find(linked.value);

    return yield* Option.match(account, {
      onNone: () => signInPageFor(request, 401, unconfirmed.reason),
      onSome: (found) => completed(found.handle, request),
    });
  });

/**
 * Links the Google account to `handle`, then back to the client as it; a
 * Google account another handle holds stays theirs, and is refused.
 */
const linkedTo = (
  subject: GoogleSubject,
  handle: Handle,
  request: AuthRequest
) =>
  Effect.gen(function* () {
    const identities = yield* Identities;

    const linked = yield* identities.link("google", subject, handle).pipe(
      Effect.as(true),
      Effect.catchTag("IdentityTaken", () => Effect.succeed(false))
    );

    return linked
      ? yield* completed(handle, request)
      : yield* signInPageFor(request, 409, GoogleSays.linkedElsewhere);
  });

const CallbackQuery = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  state: Schema.String,
});

/**
 * `GET /oauth/google/callback?code=…&state=…`: Google sends the browser
 * back. A `state` this platform did not seal, or this browser did not
 * start, is a sign-in to start again. Past that, Google not confirming the
 * person (a refusal, a bad ID token) shows the sign-in page again with a
 * plain message; a confirmed person is signed in, linked, or asked for a
 * handle.
 */
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
            googleSubject({
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

const PostedHandle = Schema.Struct({
  csrf: Schema.String,
  handle: Schema.String,
  request: Schema.String,
});

/**
 * `POST /oauth/google/handle`: the person Google confirmed takes a handle,
 * by sign-up's rules and limit, and is signed in as it, with Google linked.
 * The account's password is one nobody is told: Google signs it in. A
 * subject linked meanwhile (the form posted twice) signs in as its handle.
 */
const handleChosen = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey, pepper } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const identities = yield* Identities;

    const attempts = yield* SignInAttempts;

    const { handles: held } = yield* HeldHandles;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(
      PostedHandle
    ).pipe(Effect.mapError(() => startAgain));

    const pending = yield* pendingHandles.open(cookieKey, form.request);

    if (
      pending.csrf !== form.csrf ||
      request.cookies[CSRF_COOKIE] !== form.csrf
    ) {
      return yield* startAgain;
    }

    if (!(yield* attempts.admit(`sign-up:${addressOf(request)}`))) {
      return yield* pickHandle(
        pending.subject,
        pending.request,
        429,
        Says.tooManySignUps
      );
    }

    if (Option.isSome(yield* identities.handleOf("google", pending.subject))) {
      return yield* signedInAs(pending.subject, pending.request);
    }

    const checked = chosenHandle(form.handle, held);

    if (Result.isFailure(checked)) {
      return yield* pickHandle(
        pending.subject,
        pending.request,
        checked.failure.status,
        checked.failure.message
      );
    }

    const hash = yield* hashPassword(pepper, Redacted.make(yield* freshSecret));

    const created = yield* accounts.create(checked.success, hash).pipe(
      Effect.as(true),
      Effect.catchTag("HandleTaken", () => Effect.succeed(false))
    );

    if (!created) {
      return yield* pickHandle(
        pending.subject,
        pending.request,
        409,
        Says.handleTaken
      );
    }

    return yield* linkedTo(pending.subject, checked.success, pending.request);
  });

/** What Google sign-in's routes run on, besides the request's own `Authorization`. */
export type GoogleServices = Fetch | GoogleClient | Identities | SignInServices;

/**
 * Google sign-in's routes, added only when the platform has a Google OAuth
 * client: without one there are none, and their paths answer 404. Each
 * runs with the services taken once when the router is built, Google's
 * keys among them, so the keys live as long as the router (the isolate).
 */
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
      Context.add(OAuthStore, yield* OAuthStore),
      Context.add(SignInAttempts, yield* SignInAttempts),
      Context.add(SignInKeys, yield* SignInKeys),
      Context.add(SignInOffers, yield* SignInOffers)
    );

    /** Adds a route, its failures shown as pages and the services provided. */
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
