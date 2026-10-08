/**
 * A decider's session on the web. The platform is the OAuth
 * authorization server; the web is one of its public clients, and
 * signs a person in with PKCE: `/auth/signin` sends the browser to the
 * platform's `/authorize`, `/auth/callback` trades the code at the
 * platform's `/token` over `PLATFORM`, and the access token goes into one
 * HttpOnly cookie on the web's origin. The page's JavaScript never sees it,
 * no URL, log line or response body carries it, and the web holds no
 * secret: PKCE needs none, and the web's client is a Client ID Metadata
 * Document the web serves itself (`/auth/client`).
 *
 * Every forward to the platform (`backend.ts`) turns that cookie into the
 * HTTP `Authorization` header, the only credential the platform reads,
 * and drops the browser's own cookies and any `authorization` it
 * set: the browser never chooses the credential.
 */
import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import type { Handle } from "@repo/protocol/ids";
import { Data, Effect, Option, Redacted, Schema } from "effect";
import type { Layer } from "effect";

/**
 * The session cookie: the platform's access token. `__Host-` keeps it to
 * this exact origin over HTTPS, so no sibling host under the same site
 * (another Worker on the account's `workers.dev` subdomain) can set or
 * shadow it.
 */
export const SESSION_COOKIE = "__Host-session";

/** The cookie a sign-in in progress waits in: its state, PKCE verifier and way back. */
const SIGN_IN_COOKIE = "__Host-sign-in";

/** How long a sign-in in progress waits for its callback: ten minutes. */
const SIGN_IN_SECONDS = 600;

/**
 * How much sooner than its token the session cookie expires, so a cookie
 * never carries a token the platform has just let go.
 */
const SESSION_MARGIN_SECONDS = 60;

/** The web's own sign-in paths that this module names in what it answers. */
const AUTH_PATHS = {
  callback: "/auth/callback",
  client: "/auth/client",
  signIn: "/auth/signin",
} as const;

/** What a route's server handler is handed, of what it uses. */
export interface Handled {
  readonly request: Request;
}

// --- The cookie -------------------------------------------------------------

/**
 * A platform token as the session cookie carries it: no space, quote,
 * comma, semicolon or backslash. The callback keeps only such a token and
 * `credentialFrom` reads back only such a token, so a cookie is never set
 * that no later request could be signed in with.
 */
const Token = Schema.NonEmptyString.check(Schema.isPattern(/^[^\s",;\\]+$/u));

const isToken = Schema.is(Token);

/** A cookie value as it was set, if it decodes. */
const decodedValue = Option.liftThrowable(decodeURIComponent);

/** The value of the cookie `name` the request carries, if it carries one. */
const cookieValue = (request: Request, name: string) =>
  Option.fromNullishOr(request.headers.get("cookie")).pipe(
    Option.flatMap((header) =>
      Option.fromUndefinedOr(
        header
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${name}=`))
      )
    ),
    Option.map((pair) => pair.slice(name.length + 1)),
    Option.flatMap(decodedValue)
  );

/** The session cookie's value: the platform token this browser signed in with. */
export const credentialFrom = (request: Request): Option.Option<string> =>
  cookieValue(request, SESSION_COOKIE).pipe(Option.filter(isToken));

/**
 * `request` as the platform should see it: without the browser's cookies
 * and without any `authorization` the browser set, and with `Authorization:
 * Bearer <token>` when there is a session.
 */
export const withCredential = (
  request: Request,
  token: Option.Option<string>
): Request => {
  const headers = new Headers(request.headers);

  headers.delete("authorization");
  headers.delete("cookie");

  if (Option.isSome(token)) {
    headers.set("authorization", `Bearer ${token.value}`);
  }

  return new Request(request, { headers });
};

/** A cookie only this origin's HTTP requests carry, never the page's JavaScript. */
const lockedCookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;

/** The `Set-Cookie` value that holds `token` for `maxAgeSeconds`. */
export const sessionCookie = (token: string, maxAgeSeconds: number) =>
  lockedCookie(SESSION_COOKIE, token, maxAgeSeconds);

/** The `Set-Cookie` value that ends the session now. */
export const clearedCookie = () => lockedCookie(SESSION_COOKIE, "", 0);

const clearedSignIn = () => lockedCookie(SIGN_IN_COOKIE, "", 0);

/** `headers`, also setting each of `cookies` (each its own `Set-Cookie` line). */
export const settingCookies = (
  headers: HeadersInit,
  cookies: readonly string[]
) => {
  const all = new Headers(headers);

  for (const cookie of cookies) {
    all.append("set-cookie", cookie);
  }

  return all;
};

// --- PKCE -------------------------------------------------------------------

const encodeBase64Url = Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url);

/** `size` bytes from WebCrypto's `getRandomValues`, in base64url. */
const randomText = (size: number) =>
  Effect.sync(() => crypto.getRandomValues(new Uint8Array(size))).pipe(
    Effect.flatMap(encodeBase64Url),
    Effect.orDie
  );

/** The S256 code challenge for `verifier`: `BASE64URL(SHA256(verifier))`. */
export const challengeOf = (verifier: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  ).pipe(
    Effect.flatMap((digest) => encodeBase64Url(new Uint8Array(digest))),
    Effect.orDie
  );

/** A fresh PKCE verifier and its challenge, and a fresh state, each 32 random bytes. */
export const pkce = Effect.gen(function* () {
  const verifier = yield* randomText(32);

  return {
    challenge: yield* challengeOf(verifier),
    state: yield* randomText(32),
    verifier,
  };
});

// --- Where the browser goes -------------------------------------------------

/** The web's OAuth client id at `origin`: the URL of its metadata document. */
const clientIdOf = (origin: string) => `${origin}${AUTH_PATHS.client}`;

/** Where the platform sends the browser back to, at `origin`. */
const redirectUriOf = (origin: string) => `${origin}${AUTH_PATHS.callback}`;

/**
 * Where to go after signing in or out: `wanted` when it is a path on this
 * web (resolved against its origin, so `//host`, `/\host` and a full URL
 * elsewhere all fall back) and not a sign-in path itself; the front page
 * otherwise.
 */
export const returnPath = (origin: string, wanted: string | null) =>
  Option.fromNullishOr(wanted).pipe(
    Option.filter((path) => path.startsWith("/")),
    Option.flatMap((path) => Option.fromNullishOr(URL.parse(path, origin))),
    Option.filter((url) => url.origin === origin),
    Option.map(({ hash, pathname, search }) => `${pathname}${search}${hash}`),
    Option.filter((path) => !path.startsWith("/auth/")),
    Option.getOrElse(() => "/")
  );

/** A 302 to `location` that sets `cookies` and is never cached. */
export const redirect = (location: string, cookies: readonly string[]) =>
  new Response(null, {
    headers: settingCookies(
      {
        "cache-control": "no-store",
        location,
        "referrer-policy": "no-referrer",
      },
      cookies
    ),
    status: 302,
  });

/** A short page that says why signing in stopped, and how to start again. */
const stoppedPage = (
  status: number,
  reason: string,
  cookies: readonly string[]
) => {
  const headers = settingCookies(
    {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    },
    cookies
  );

  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Sign-in stopped · ${Brand.name}</title><p>${reason}</p><p><a href="${AUTH_PATHS.signIn}">Sign in again</a> or go to <a href="/">the front page</a>.</p>`,
    { headers, status }
  );
};

// --- Sign-in ----------------------------------------------------------------

/** A sign-in in progress, as its cookie holds it. */
const PendingSignIn = Schema.Struct({
  return: Schema.String,
  state: Schema.String,
  verifier: Schema.String,
});

const PendingCookie = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(PendingSignIn))
);

const encodePending = Schema.encodeEffect(PendingCookie);

const decodePending = Schema.decodeOption(PendingCookie);

/**
 * `GET /auth/signin[?return=<path>]`: to the platform's `/authorize` with a
 * fresh PKCE challenge and state; the verifier, the state and the way back
 * wait in a short-lived HttpOnly cookie for the callback.
 */
export const signInHandler =
  (env: Env) =>
  ({ request }: Handled): Promise<Response> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const here = new URL(request.url);
        const { challenge, state, verifier } = yield* pkce;

        const pending = yield* encodePending({
          return: returnPath(here.origin, here.searchParams.get("return")),
          state,
          verifier,
        }).pipe(Effect.orDie);

        const authorize = new URL("/authorize", env.PUBLIC_PLATFORM_URL);

        authorize.search = new URLSearchParams({
          client_id: clientIdOf(here.origin),
          code_challenge: challenge,
          code_challenge_method: "S256",
          redirect_uri: redirectUriOf(here.origin),
          response_type: "code",
          state,
        }).toString();

        return redirect(authorize.href, [
          lockedCookie(SIGN_IN_COOKIE, pending, SIGN_IN_SECONDS),
        ]);
      })
    );

// --- The callback -----------------------------------------------------------

/** Signing in stopped before a session: a 400 the person reads, or a 502 when the platform could not be asked. */
class SignInStopped extends Data.TaggedError("SignInStopped")<{
  readonly reason: string;
  readonly status: 400 | 502;
}> {}

const startAgain = new SignInStopped({
  reason:
    "This sign-in was not started in this browser, or it took longer than ten minutes.",
  status: 400,
});

const refused = new SignInStopped({
  reason: "The platform did not complete this sign-in.",
  status: 400,
});

const unreachablePlatform = new SignInStopped({
  reason: "The platform could not be reached to complete this sign-in.",
  status: 502,
});

/** What the platform's `/token` answers a good code with, of what the web keeps. */
const TokenAnswer = Schema.Struct({
  access_token: Schema.RedactedFromValue(Token),
  expires_in: Schema.Int.check(Schema.isGreaterThan(0)),
  token_type: Schema.String,
});

const decodeTokenAnswer = Schema.decodeEffect(
  Schema.fromJsonString(TokenAnswer)
);

/** Trades `code` for an access token at the platform's `/token`, over `PLATFORM`. */
const exchange = (
  env: Env,
  input: {
    readonly code: string;
    readonly origin: string;
    readonly verifier: string;
  }
) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      catch: () => unreachablePlatform,
      try: () =>
        env.PLATFORM.fetch(
          new Request(new URL("/token", env.PUBLIC_PLATFORM_URL), {
            body: new URLSearchParams({
              client_id: clientIdOf(input.origin),
              code: input.code,
              code_verifier: input.verifier,
              grant_type: "authorization_code",
              redirect_uri: redirectUriOf(input.origin),
            }),
            headers: {
              accept: "application/json",
              "content-type": "application/x-www-form-urlencoded",
            },
            method: "POST",
          })
        ),
    });

    if (!response.ok) {
      return yield* refused;
    }

    const body = yield* Effect.tryPromise({
      catch: () => refused,
      try: () => response.text(),
    });

    const answer = yield* decodeTokenAnswer(body).pipe(
      Effect.mapError(() => refused)
    );

    if (answer.token_type.toLowerCase() !== "bearer") {
      return yield* refused;
    }

    return answer;
  });

/**
 * `GET /auth/callback?code=…&state=…`: the state must be the one this
 * browser's sign-in cookie holds; then the code and its verifier go to the
 * platform's `/token`, and the token comes back only as the session cookie,
 * set to expire before the token does, on a 302 to the way back.
 */
export const callbackHandler =
  (env: Env) =>
  ({ request }: Handled): Promise<Response> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const here = new URL(request.url);

        const pending = yield* Effect.fromOption(
          Option.flatMap(cookieValue(request, SIGN_IN_COOKIE), decodePending)
        ).pipe(Effect.mapError(() => startAgain));

        if (here.searchParams.get("state") !== pending.state) {
          return yield* startAgain;
        }

        const code = here.searchParams.get("code") ?? "";

        if (code === "") {
          return yield* refused;
        }

        const answer = yield* exchange(env, {
          code,
          origin: here.origin,
          verifier: pending.verifier,
        });

        return redirect(returnPath(here.origin, pending.return), [
          sessionCookie(
            Redacted.value(answer.access_token),
            answer.expires_in - SESSION_MARGIN_SECONDS
          ),
          clearedSignIn(),
        ]);
      }).pipe(
        Effect.catchTag("SignInStopped", ({ reason, status }) =>
          Effect.succeed(stoppedPage(status, reason, [clearedSignIn()]))
        )
      )
    );

// --- Sign-out, who, and the client -------------------------------------------

/** `POST` (or a plain link's `GET`) `/auth/signout`: the session cookie ends, and the browser goes home. */
export const signOutHandler = (_handled: Handled): Response =>
  redirect("/", [clearedCookie()]);

/** `/auth/whoami`'s answer: the handle signed in, or nothing (`features/auth/who.ts` reads it). */
const whoAnswer = (
  who: { readonly handle?: Handle },
  cookies: readonly string[] = []
) =>
  Response.json(who, {
    headers: settingCookies({ "cache-control": "no-store" }, cookies),
  });

/**
 * `GET /auth/whoami`: `{ handle }` as the platform's `status` names the
 * session's caller, or `{}`. With no session the platform is not asked. A
 * session the platform no longer knows answers `Unauthenticated` (the
 * backend asks again with no credential), so its cookie is expired here.
 */
export const whoamiHandler =
  (clientFor: (request: Request) => Layer.Layer<Client>) =>
  ({ request }: Handled): Promise<Response> =>
    Effect.runPromise(
      Option.match(credentialFrom(request), {
        onNone: () => Effect.succeed(whoAnswer({})),
        onSome: () =>
          Effect.service(Client).pipe(
            Effect.flatMap((client) => client.status({})),
            Effect.map(({ handle }) => whoAnswer({ handle })),
            Effect.catchTag("Unauthenticated", () =>
              Effect.succeed(whoAnswer({}, [clearedCookie()]))
            ),
            Effect.orElseSucceed(() => whoAnswer({})),
            Effect.provide(clientFor(request))
          ),
      })
    );

/**
 * The web's OAuth client at `origin`, as a Client ID Metadata Document: a
 * public client (PKCE, no secret) whose id is this document's URL and whose
 * one redirect is the web's callback. The platform reads it when the
 * browser arrives at `/authorize`, so nothing is registered there.
 */
export const webClientMetadata = (origin: string) => ({
  client_id: clientIdOf(origin),
  client_name: `${Brand.name} web`,
  client_uri: origin,
  grant_types: ["authorization_code"],
  redirect_uris: [redirectUriOf(origin)],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
});

/** `GET /auth/client`: the web's Client ID Metadata Document. */
export const clientMetadataHandler = ({ request }: Handled): Response =>
  Response.json(webClientMetadata(new URL(request.url).origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
