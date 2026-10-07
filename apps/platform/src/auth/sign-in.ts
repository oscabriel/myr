/**
 * The platform's own sign-in: a person signs up with a handle and a
 * password, or signs in with them, on `/authorize` and `/signup`, and the
 * OAuth client that sent them there (the CLI over a loopback redirect, an
 * MCP client) gets a code for a platform token whose props are only
 * `{ handle }`. The provider validates the request and issues the code;
 * these routes decide who the person is.
 *
 * A sign-in in progress travels in the form, sealed with `COOKIE_KEY`
 * (`state.ts`), and its CSRF token in a `__Host-` cookie. Sign-in never says
 * whether a handle exists; sign-up must say a handle is taken.
 *
 * Google sign-in (`google.ts`, issue 419) is offered on the same page when
 * the platform has a Google OAuth client, and reuses these pages, rules and
 * the code's completion; this module knows of it only as `SignInOffers`.
 */
import {
  AuthorizationError,
  CimdFetchError,
} from "@cloudflare/workers-oauth-provider";
import type {
  AuthRequest as ProviderAuthRequest,
  OAuthAuthorizationServer,
} from "@cloudflare/workers-oauth-provider";
import { Brand } from "@repo/brand";
import { Handle, sameHandle } from "@repo/protocol/ids";
import {
  Context,
  Data,
  Effect,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { Accounts, handleKey } from "./accounts.ts";
import { SignInAttempts } from "./attempts.ts";
import { CLI_CLIENT_PATH, cliClientMetadata } from "./cli-client.ts";
import { OAuthStore } from "./oauth-store.ts";
import { problemPage, signInPage, signUpPage } from "./pages.ts";
import type { Asker, PendingForm } from "./pages.ts";
import {
  hashPassword,
  PasswordHash,
  PasswordPolicy,
  verifyPassword,
} from "./password.ts";
import {
  openState,
  sealState,
  SIGN_IN_LIFETIME,
  SignInFailed,
  startAgain,
} from "./state.ts";
import type { AuthRequest, PendingSignIn } from "./state.ts";

/** Sign-in's secrets: `COOKIE_KEY` signs forms, `PASSWORD_PEPPER` peppers passwords. */
export class SignInKeys extends Context.Service<
  SignInKeys,
  {
    readonly cookieKey: Redacted.Redacted;
    readonly pepper: Redacted.Redacted;
  }
>()("platform/SignInKeys") {}

/**
 * What the sign-in page offers besides a password: Google's sign-in when
 * the platform has a Google OAuth client (issue 419), named by the origin
 * its forms may then send a person on to (`form-action`).
 */
export class SignInOffers extends Context.Service<
  SignInOffers,
  { readonly google: Option.Option<string> }
>()("platform/SignInOffers") {}

/**
 * The handles named sessions already hold: the operator's and each one in
 * `SESSION_TOKENS` (spec §8 D9). Nobody signs up as one, or an account
 * would call as that person.
 */
export class HeldHandles extends Context.Service<
  HeldHandles,
  { readonly handles: readonly Handle[] }
>()("platform/HeldHandles") {}

/** What the provider's env holds: only its store. */
export interface OAuthEnv {
  readonly OAUTH_KV: OAuthStore["Service"];
}

/**
 * Per request: the authorization server for the origin the request reached
 * (its issuer and its one resource), and the Worker's context for it.
 */
export class Authorization extends Context.Service<
  Authorization,
  {
    readonly context: ExecutionContext;
    readonly origin: string;
    readonly server: OAuthAuthorizationServer<OAuthEnv>;
  }
>()("platform/Authorization") {}

/** The paths the provider answers itself: its metadata and its token endpoint. */
export const AUTHORIZATION_SERVER_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/token",
] as const;

/** The paths sign-in's pages answer, and the CLI's client metadata document. */
export const SIGN_IN_PATHS = [
  "/authorize",
  "/signup",
  CLI_CLIENT_PATH,
] as const;

/** Handles nobody may sign up with: the platform's own words. */
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  Brand.slug,
  "admin",
  "api",
  "platform",
  "root",
  "security",
  "support",
  "www",
]);

/** An account's handle: protocol's `Handle`, at most 39 characters. */
const AccountHandle = Handle.check(Schema.isMaxLength(39));

const decodeHandle = Schema.decodeUnknownOption(AccountHandle);

/** A password's length, in characters as a person counts them (graphemes), never its content. */
const PasswordLength = { max: 256, min: 12 } as const;

/** What a person reads on a page, each a plain sentence. */
export const Says = {
  handleReserved: "That handle is reserved. Choose another.",
  handleSpelling:
    "A handle is 1 to 39 letters, digits and dashes, starting with a letter or digit.",
  handleTaken: "That handle is taken. Choose another, or sign in.",
  passwordLength: "A password is 12 to 256 characters.",
  tooManySignIns:
    "Too many sign-in attempts for this handle or from here. Wait a minute, then try again.",
  tooManySignUps: "Too many sign-ups from here. Wait a minute, then try again.",
  unverifiedClient:
    "This app could not be verified: its client metadata document could not be read.",
  wrong: "The handle or password is wrong.",
} as const;

/**
 * Verified against when no account has the handle, so a missing account
 * costs the same derivation as a wrong password and timing names nobody.
 */
const STAND_IN_HASH = PasswordHash.make(
  `pbkdf2-sha256$${PasswordPolicy.iterations}$${"A".repeat(22)}$${"A".repeat(43)}`
);

/** The cookie a sign-in form's CSRF token is kept in: this site's own requests only. */
export const CSRF_COOKIE = "__Host-sign-in";

export const csrfCookie = {
  httpOnly: true,
  path: "/",
  sameSite: "strict",
  secure: true,
} as const;

const BASE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'";

/**
 * Where a form's redirect may go: the redirect URI's origin, or only its
 * scheme when its host is an IPv6 literal (`http://[::1]:<port>`), which
 * CSP's host grammar cannot name. The provider allows only https, and http
 * on a loopback host.
 */
const redirectSource = (redirectUri: string) =>
  Option.fromNullishOr(URL.parse(redirectUri)).pipe(
    Option.filter(({ origin }) => origin !== "null"),
    Option.map(({ hostname, origin, protocol }) =>
      hostname.startsWith("[") ? protocol : origin
    )
  );

/**
 * The page's CSP. A form's post is answered with a redirect to the client,
 * and browsers hold that redirect to `form-action` too, so a page with a
 * form also allows its (provider-validated) redirect URI, and any other
 * place its forms may send a person on to (`formActions`: Google's sign-in).
 */
const contentSecurityPolicy = (
  redirectUri?: string,
  formActions: readonly string[] = []
) =>
  [
    BASE_CSP,
    ...Option.toArray(
      Option.flatMap(Option.fromUndefinedOr(redirectUri), redirectSource)
    ),
    ...formActions,
  ].join(" ");

/** An HTML page that loads nothing, cannot be framed and is never cached. */
export const htmlPage = (
  body: string,
  status: number,
  redirectUri?: string,
  formActions: readonly string[] = []
) =>
  HttpServerResponse.text(body, {
    contentType: "text/html; charset=utf-8",
    headers: {
      "cache-control": "no-store",
      "content-security-policy": contentSecurityPolicy(
        redirectUri,
        formActions
      ),
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
    status,
  });

/** A provider call failed: a refusal to show the person, or a defect. */
class ProviderFailed extends Data.TaggedError("ProviderFailed")<{
  readonly cause: unknown;
}> {}

/**
 * A provider call. Its request-validation failures become a page the
 * person reads (or the client's own error redirect, when the provider
 * validated it); anything else is a defect, a 500.
 */
const provider = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) => new ProviderFailed({ cause }),
    try: call,
  }).pipe(
    Effect.catchTag("ProviderFailed", ({ cause }) => {
      if (cause instanceof AuthorizationError) {
        return Effect.fail(
          cause.redirectTo === undefined
            ? new SignInFailed({ reason: cause.description })
            : new SignInFailed({
                reason: cause.description,
                redirectTo: cause.redirectTo,
              })
        );
      }

      return cause instanceof CimdFetchError
        ? Effect.fail(new SignInFailed({ reason: Says.unverifiedClient }))
        : Effect.die(cause);
    })
  );

/** The provider's helpers for this request's origin, over the store. */
const oauthApi = Effect.gen(function* () {
  const { server } = yield* Authorization;

  const store = yield* OAuthStore;

  return server.getOAuthApi({ OAUTH_KV: store });
});

/** A sealed request in the provider's own type: an absent key stays absent, never `undefined`. */
const forProvider = (request: AuthRequest) => {
  const provided: ProviderAuthRequest = {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    responseType: request.responseType,
    scope: [...request.scope],
    state: request.state,
  };

  if (request.codeChallenge !== undefined) {
    provided.codeChallenge = request.codeChallenge;
  }

  if (request.codeChallengeMethod !== undefined) {
    provided.codeChallengeMethod = request.codeChallengeMethod;
  }

  if (request.issuer !== undefined) {
    provided.issuer = request.issuer;
  }

  if (request.resource !== undefined) {
    provided.resource = request.resource;
  }

  return provided;
};

/** Who asks, as the provider describes the client (its name may be the client's own claim). */
export const askerOf = (request: AuthRequest) =>
  Effect.gen(function* () {
    const api = yield* oauthApi;

    const consent = yield* provider(() =>
      api.describeConsent(forProvider(request))
    );

    const asker: Asker = {
      clientDomain: consent.clientDomain,
      clientName: consent.clientName,
      redirectHost: consent.redirectHost,
      redirectIsLoopback: consent.redirectIsLoopback,
    };

    return asker;
  });

/** Where signing in starts for `request`: `/authorize` with its own parameters. */
export const authorizeHref = (request: AuthRequest) => {
  const query = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: request.responseType,
    state: request.state,
  });

  const optional = [
    ["code_challenge", request.codeChallenge],
    ["code_challenge_method", request.codeChallengeMethod],
    ["resource", request.resource],
    ["scope", request.scope.length === 0 ? undefined : request.scope.join(" ")],
  ] as const;

  for (const [name, value] of optional) {
    if (value !== undefined) {
      query.set(name, value);
    }
  }

  return `/authorize?${query.toString()}`;
};

const encodeToken = Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url);

/** A fresh CSRF token each time it runs: 32 random bytes, base64url. */
export const freshCsrf = Effect.sync(() =>
  crypto.getRandomValues(new Uint8Array(32))
).pipe(Effect.flatMap(encodeToken), Effect.orDie);

/** What a sign-in or sign-up form posts. */
const PostedForm = Schema.Struct({
  csrf: Schema.String,
  handle: Schema.String,
  password: Schema.String,
  request: Schema.String,
});

type PostedForm = typeof PostedForm.Type;

/**
 * The posted form and the sign-in it continues: sealed by this platform
 * with `COOKIE_KEY`, not expired, and its CSRF token the same in the seal,
 * the form and this browser's cookie. Anything else starts again.
 */
const postedSignIn = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const form = yield* HttpServerRequest.schemaBodyUrlParams(PostedForm).pipe(
      Effect.mapError(() => startAgain)
    );

    const pending = yield* openState(cookieKey, form.request);

    const cookie = request.cookies[CSRF_COOKIE];

    if (pending.csrf !== form.csrf || cookie !== form.csrf) {
      return yield* startAgain;
    }

    return { form, pending };
  });

/** The client's address, as Cloudflare saw it. */
export const addressOf = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["cf-connecting-ip"] ?? "unknown";

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Characters as a person counts them: graphemes, not UTF-16 units. */
const lengthOf = (password: string) => [...graphemes.segment(password)].length;

const passwordFits = (password: string) =>
  lengthOf(password) >= PasswordLength.min &&
  lengthOf(password) <= PasswordLength.max;

/**
 * The provider records the grant and its code, and the browser goes back
 * to the client with it. The token's props carry only `{ handle }`; the
 * grant's user is the handle's key, so a grant is one account's in any case.
 */
export const completed = (handle: Handle, request: AuthRequest) =>
  Effect.gen(function* () {
    const api = yield* oauthApi;

    const { redirectTo } = yield* provider(() =>
      api.completeAuthorization({
        metadata: {},
        props: { handle },
        request: forProvider(request),
        scope: [...request.scope],
        userId: handleKey(handle),
      })
    );

    return yield* HttpServerResponse.redirect(redirectTo, {
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
      status: 302,
    }).pipe(
      HttpServerResponse.setCookie(CSRF_COOKIE, "", {
        ...csrfCookie,
        maxAge: 0,
      }),
      Effect.orDie
    );
  });

/**
 * The sign-in page for `request` with `form`, and the ways to sign in on
 * offer: Google's too, and its origin among the places the forms may send
 * a person on to, when the platform offers it.
 */
const offeredSignIn = (
  request: AuthRequest,
  form: PendingForm,
  status: number,
  message?: string
) =>
  Effect.gen(function* () {
    const { google } = yield* SignInOffers;

    const asker = yield* askerOf(request);

    return htmlPage(
      signInPage(asker, form, { google: Option.isSome(google) }, message),
      status,
      request.redirectUri,
      Option.toArray(google)
    );
  });

/**
 * The sign-in form for `request`, afresh: a new CSRF token, sealed with the
 * request into the form and set as this browser's cookie, and why the
 * person is here again (`message`), if they are.
 */
export const signInPageFor = (
  request: AuthRequest,
  status: number,
  message?: string
) =>
  Effect.gen(function* () {
    const { cookieKey } = yield* SignInKeys;

    const csrf = yield* freshCsrf;

    const pending: PendingSignIn = { csrf, request };

    const sealed = yield* sealState(cookieKey, pending);

    const page = yield* offeredSignIn(
      request,
      { csrf, request: sealed },
      status,
      message
    );

    return yield* page.pipe(
      HttpServerResponse.setCookie(CSRF_COOKIE, csrf, {
        ...csrfCookie,
        maxAge: SIGN_IN_LIFETIME,
      }),
      Effect.orDie
    );
  });

/** `GET /authorize`: the provider validates the client's request; the sign-in form. */
const showSignIn = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const api = yield* oauthApi;

    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

    const parsed = yield* provider(() => api.parseAuthRequest(web));

    return yield* signInPageFor(parsed, 200);
  });

/** The sign-in form again, with why it did not go through. */
const signInAgain = (
  pending: PendingSignIn,
  form: PendingForm,
  status: number,
  message: string
) => offeredSignIn(pending.request, form, status, message);

/**
 * A posted sign-in form, by handle and password, then `signedIn` with the
 * person's handle and the sign-in it continues. The sixth attempt in a
 * minute for one handle, or from one address, is refused before any
 * password is checked; a wrong handle and a wrong password read the same,
 * and show the sign-in form again; a hash made with fewer iterations than
 * today's is replaced.
 */
export const byPassword = <E, R>(
  request: HttpServerRequest.HttpServerRequest,
  signedIn: (
    handle: Handle,
    pending: PendingSignIn
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
) =>
  Effect.gen(function* () {
    const { pepper } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const attempts = yield* SignInAttempts;

    const { form, pending } = yield* postedSignIn(request);

    const shown: PendingForm = { csrf: form.csrf, request: form.request };

    const handle = decodeHandle(form.handle);

    const admitted = yield* Effect.all([
      attempts.admit(`address:${addressOf(request)}`),
      ...Option.match(handle, {
        onNone: () => [],
        onSome: (named) => [attempts.admit(`handle:${handleKey(named)}`)],
      }),
    ]);

    if (!admitted.every(Boolean)) {
      return yield* signInAgain(pending, shown, 429, Says.tooManySignIns);
    }

    const password = Redacted.make(form.password);

    const account = passwordFits(form.password)
      ? yield* Option.match(handle, {
          onNone: () => Effect.succeedNone,
          onSome: accounts.find,
        })
      : Option.none();

    const { needsRehash, ok } = yield* verifyPassword(
      pepper,
      password,
      Option.match(account, {
        onNone: () => STAND_IN_HASH,
        onSome: ({ hash }) => hash,
      })
    );

    if (Option.isNone(account) || !ok) {
      return yield* signInAgain(pending, shown, 401, Says.wrong);
    }

    if (needsRehash) {
      yield* accounts.setPasswordHash(
        account.value.handle,
        yield* hashPassword(pepper, password)
      );
    }

    return yield* signedIn(account.value.handle, pending);
  });

/** `POST /authorize`: signed in by handle and password, back to the client with a code. */
const signIn = (request: HttpServerRequest.HttpServerRequest) =>
  byPassword(request, (handle, pending) => completed(handle, pending.request));

/** `GET /signup?request=<sealed>`: the sign-up form for a sign-in in progress. */
const showSignUp = Effect.gen(function* () {
  const { cookieKey } = yield* SignInKeys;

  const { request: sealed } = yield* HttpServerRequest.schemaSearchParams(
    Schema.Struct({ request: Schema.String })
  ).pipe(Effect.mapError(() => startAgain));

  const pending = yield* openState(cookieKey, sealed);

  const asker = yield* askerOf(pending.request);

  return htmlPage(
    signUpPage(
      asker,
      { csrf: pending.csrf, request: sealed },
      authorizeHref(pending.request)
    ),
    200,
    pending.request.redirectUri
  );
});

/** Why a sign-up did not go through: the page's status and its plain sentence. */
export interface Refused {
  readonly message: string;
  readonly status: number;
}

/**
 * The handle a new account may take, or why it may not: its spelling, the
 * platform's reserved words, and the handles named sessions hold (taken,
 * like an account's). Sign-up and Google's first sign-in both use it.
 */
export const chosenHandle = (
  handle: string,
  held: readonly Handle[]
): Result.Result<Handle, Refused> =>
  Option.match(decodeHandle(handle), {
    onNone: () => Result.fail({ message: Says.handleSpelling, status: 400 }),
    onSome: (chosen) => {
      if (RESERVED_HANDLES.has(handleKey(chosen))) {
        return Result.fail({ message: Says.handleReserved, status: 400 });
      }

      if (held.some((holder) => sameHandle(holder, chosen))) {
        return Result.fail({ message: Says.handleTaken, status: 409 });
      }

      return Result.succeed(chosen);
    },
  });

/** The handle a sign-up may take, or why it may not: `chosenHandle`'s rules, and the password's length. */
const signUpHandle = (
  form: PostedForm,
  held: readonly Handle[]
): Result.Result<Handle, Refused> =>
  Result.flatMap(chosenHandle(form.handle, held), (handle) =>
    passwordFits(form.password)
      ? Result.succeed(handle)
      : Result.fail({ message: Says.passwordLength, status: 400 })
  );

/**
 * `POST /signup`: a new account, then signed in at once. Sign-ups are
 * limited per address like sign-ins; a taken handle, in any case, is said
 * to be taken, whether an account or a named session holds it.
 */
const signUp = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { pepper } = yield* SignInKeys;

    const accounts = yield* Accounts;

    const attempts = yield* SignInAttempts;

    const { handles: held } = yield* HeldHandles;

    const { form, pending } = yield* postedSignIn(request);

    const again = (status: number, message: string) =>
      askerOf(pending.request).pipe(
        Effect.map((asker) =>
          htmlPage(
            signUpPage(
              asker,
              { csrf: form.csrf, request: form.request },
              authorizeHref(pending.request),
              message
            ),
            status,
            pending.request.redirectUri
          )
        )
      );

    if (!(yield* attempts.admit(`sign-up:${addressOf(request)}`))) {
      return yield* again(429, Says.tooManySignUps);
    }

    const checked = signUpHandle(form, held);

    if (Result.isFailure(checked)) {
      return yield* again(checked.failure.status, checked.failure.message);
    }

    const hash = yield* hashPassword(pepper, Redacted.make(form.password));

    const created = yield* accounts.create(checked.success, hash).pipe(
      Effect.as(true),
      Effect.catchTag("HandleTaken", () => Effect.succeed(false))
    );

    if (!created) {
      return yield* again(409, Says.handleTaken);
    }

    return yield* completed(checked.success, pending.request);
  });

/** `GET /oauth/cli`: the CLI's client metadata document, its URL its client id. */
const cliClient = Effect.gen(function* () {
  const { origin } = yield* Authorization;

  return HttpServerResponse.jsonUnsafe(cliClientMetadata(origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
});

/** Metadata and the token endpoint, as the provider answers them. */
const authorizationServer = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { context, server } = yield* Authorization;

    const store = yield* OAuthStore;

    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

    const response = yield* Effect.promise(() =>
      server.fetch(web, { OAUTH_KV: store }, context)
    );

    return HttpServerResponse.fromWeb(response);
  });

/** A failed sign-in: the client's own error redirect, or a page to start again from. */
export const failedPage = (failed: SignInFailed) =>
  Effect.succeed(
    failed.redirectTo === undefined
      ? htmlPage(problemPage(failed.reason), 400)
      : HttpServerResponse.redirect(failed.redirectTo, {
          headers: { "cache-control": "no-store" },
          status: 302,
        })
  );

/** What the routes run on, besides the request's own `Authorization`. */
export type SignInServices =
  | Accounts
  | HeldHandles
  | OAuthStore
  | SignInAttempts
  | SignInKeys
  | SignInOffers;

/**
 * Sign-in's routes, each run with the services taken once when the router
 * is built; `Authorization` comes with each request.
 */
export const signInRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(Accounts, yield* Accounts).pipe(
      Context.add(HeldHandles, yield* HeldHandles),
      Context.add(OAuthStore, yield* OAuthStore),
      Context.add(SignInAttempts, yield* SignInAttempts),
      Context.add(SignInKeys, yield* SignInKeys),
      Context.add(SignInOffers, yield* SignInOffers)
    );

    /** Adds a route, its failures shown as pages and the services provided. */
    const add = <R>(
      method: "*" | "GET" | "POST",
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

    yield* add("GET", "/authorize", showSignIn);
    yield* add("POST", "/authorize", signIn);
    yield* add("GET", "/signup", () => showSignUp);
    yield* add("POST", "/signup", signUp);
    yield* add("GET", CLI_CLIENT_PATH, () => cliClient);

    for (const path of AUTHORIZATION_SERVER_PATHS) {
      yield* add("*", path, authorizationServer);
    }
  })
);
