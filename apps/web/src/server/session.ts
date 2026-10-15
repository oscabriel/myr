// The access token lives only in an HttpOnly cookie: no URL, log line or response body carries it, and the web
// holds no secret (PKCE, and a Client ID Metadata Document it serves itself). The handle cookie beside it only
// shapes what a page shows; every call carries the token, and the platform decides who the caller is.
import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import { Handle as HandleSchema } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { Data, Effect, Option, Redacted, Schema } from "effect";
import type { Layer } from "effect";

// `__Host-` keeps it to this exact origin over HTTPS, so no sibling host on the same `workers.dev` subdomain can set or shadow it.
export const SESSION_COOKIE = "__Host-session";

export const HANDLE_COOKIE = "__Host-handle";

const SIGN_IN_COOKIE = "__Host-sign-in";

const SIGN_IN_SECONDS = 600;

/**
 * How much sooner than its token the session cookie expires, so a cookie
 * never carries a token the platform has just let go.
 */
const SESSION_MARGIN_SECONDS = 60;

const AUTH_PATHS = {
  callback: "/auth/callback",
  client: "/auth/client",
  signIn: "/auth/signin",
} as const;

// The platform ends its own session here and sends the browser to the web's home.
export const PLATFORM_SIGN_OUT = "/oauth/signout";

export interface Handled {
  readonly request: Request;
}

// Only such a token is kept and read back, so a cookie is never set that no later request could sign in with.
const Token = Schema.NonEmptyString.check(Schema.isPattern(/^[^\s",;\\]+$/u));

const isToken = Schema.is(Token);

const decodedValue = Option.liftThrowable(decodeURIComponent);

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

export const credentialFrom = (request: Request): Option.Option<string> =>
  cookieValue(request, SESSION_COOKIE).pipe(Option.filter(isToken));

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

const lockedCookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;

export const sessionCookie = (token: string, maxAgeSeconds: number) =>
  lockedCookie(SESSION_COOKIE, token, maxAgeSeconds);

export const clearedCookie = () => lockedCookie(SESSION_COOKIE, "", 0);

export const clearedCookies = () => [
  clearedCookie(),
  lockedCookie(HANDLE_COOKIE, "", 0),
];

const clearedSignIn = () => lockedCookie(SIGN_IN_COOKIE, "", 0);

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

const encodeBase64Url = Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url);

const randomText = (size: number) =>
  Effect.sync(() => crypto.getRandomValues(new Uint8Array(size))).pipe(
    Effect.flatMap(encodeBase64Url),
    Effect.orDie
  );

export const challengeOf = (verifier: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  ).pipe(
    Effect.flatMap((digest) => encodeBase64Url(new Uint8Array(digest))),
    Effect.orDie
  );

export const pkce = Effect.gen(function* () {
  const verifier = yield* randomText(32);

  return {
    challenge: yield* challengeOf(verifier),
    state: yield* randomText(32),
    verifier,
  };
});

const HANDLE_LEARNED_SECONDS = 24 * 60 * 60;

const fingerprintOf = (token: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  ).pipe(
    Effect.flatMap((digest) => encodeBase64Url(new Uint8Array(digest))),
    Effect.orDie
  );

// `<fingerprint>.<handle>`: a fingerprint is base64url, which has no `.`.
const handleCookie = (token: string, handle: Handle, maxAgeSeconds: number) =>
  Effect.map(fingerprintOf(token), (fingerprint) =>
    lockedCookie(HANDLE_COOKIE, `${fingerprint}.${handle}`, maxAgeSeconds)
  );

const decodeHandle = Schema.decodeUnknownOption(HandleSchema);

const keptHandle = (request: Request, token: string) =>
  Effect.map(fingerprintOf(token), (fingerprint) =>
    Option.flatMap(cookieValue(request, HANDLE_COOKIE), (value) => {
      const at = value.indexOf(".");

      return at > 0 && value.slice(0, at) === fingerprint
        ? decodeHandle(value.slice(at + 1))
        : Option.none();
    })
  );

const handleOf = (
  clientFor: (request: Request) => Layer.Layer<Client>,
  origin: string,
  token: string
) =>
  Effect.service(Client).pipe(
    Effect.flatMap((client) => client.whoami({})),
    Effect.map(({ handle }) => handle),
    Effect.provide(
      clientFor(
        new Request(`${origin}/auth/whoami`, {
          headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
        })
      )
    )
  );

const clientIdOf = (origin: string) => `${origin}${AUTH_PATHS.client}`;

const redirectUriOf = (origin: string) => `${origin}${AUTH_PATHS.callback}`;

// Resolved against the origin, so `//host`, `/\host` and a full URL elsewhere all fall back to the front page.
export const returnPath = (origin: string, wanted: string | null) =>
  Option.fromNullishOr(wanted).pipe(
    Option.filter((path) => path.startsWith("/")),
    Option.flatMap((path) => Option.fromNullishOr(URL.parse(path, origin))),
    Option.filter((url) => url.origin === origin),
    Option.map(({ hash, pathname, search }) => `${pathname}${search}${hash}`),
    Option.filter((path) => !path.startsWith("/auth/")),
    Option.getOrElse(() => "/")
  );

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
    `<!doctype html><meta charset="utf-8"><title>Sign-in stopped · ${Brand.name}</title><p>${reason}</p><p><a href="${AUTH_PATHS.signIn}">Sign in again</a> or go to <a href="/asks">the open asks</a>.</p>`,
    { headers, status }
  );
};

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

const TokenAnswer = Schema.Struct({
  access_token: Schema.RedactedFromValue(Token),
  expires_in: Schema.Int.check(Schema.isGreaterThan(0)),
  token_type: Schema.String,
});

const decodeTokenAnswer = Schema.decodeEffect(
  Schema.fromJsonString(TokenAnswer)
);

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

export const callbackHandler =
  (env: Env, clientFor: (request: Request) => Layer.Layer<Client>) =>
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

        const token = Redacted.value(answer.access_token);
        const lives = answer.expires_in - SESSION_MARGIN_SECONDS;

        // Signing in never waits on this: whatever stops it keeps no handle.
        const handle = yield* handleOf(clientFor, here.origin, token).pipe(
          Effect.flatMap((named) => handleCookie(token, named, lives)),
          Effect.map(Option.some),
          Effect.catchCause(() => Effect.succeedNone)
        );

        return redirect(returnPath(here.origin, pending.return), [
          sessionCookie(token, lives),
          ...Option.toArray(handle),
          clearedSignIn(),
        ]);
      }).pipe(
        Effect.catchTag("SignInStopped", ({ reason, status }) =>
          Effect.succeed(stoppedPage(status, reason, [clearedSignIn()]))
        )
      )
    );

/**
 * Ends the web's session, then the platform's, which comes home again: signed
 * out of one is signed out of both, so the next sign-in asks who you are. With
 * no platform (the dev world) it goes home at once.
 */
export const signOutHandler =
  (platformUrl: Option.Option<string>) =>
  (_handled: Handled): Response =>
    redirect(
      Option.match(platformUrl, {
        onNone: () => "/",
        onSome: (platform) => new URL(PLATFORM_SIGN_OUT, platform).href,
      }),
      clearedCookies()
    );

const whoAnswer = (
  who: { readonly handle?: Handle },
  cookies: readonly string[] = []
) =>
  Response.json(who, {
    headers: settingCookies({ "cache-control": "no-store" }, cookies),
  });

export const whoamiHandler =
  (clientFor: (request: Request) => Layer.Layer<Client>) =>
  ({ request }: Handled): Promise<Response> =>
    Effect.runPromise(
      Option.match(credentialFrom(request), {
        onNone: () =>
          Effect.succeed(
            whoAnswer(
              {},
              Option.isSome(cookieValue(request, HANDLE_COOKIE))
                ? [lockedCookie(HANDLE_COOKIE, "", 0)]
                : []
            )
          ),
        onSome: (token) =>
          Effect.flatMap(keptHandle(request, token), (kept) =>
            Option.match(kept, {
              onNone: () =>
                handleOf(clientFor, new URL(request.url).origin, token).pipe(
                  Effect.flatMap((handle) =>
                    Effect.map(
                      handleCookie(token, handle, HANDLE_LEARNED_SECONDS),
                      (cookie) => whoAnswer({ handle }, [cookie])
                    )
                  ),
                  Effect.catchTag("Unauthenticated", () =>
                    Effect.succeed(whoAnswer({}, clearedCookies()))
                  ),
                  Effect.orElseSucceed(() => whoAnswer({}))
                ),
              onSome: (handle) => Effect.succeed(whoAnswer({ handle })),
            })
          ),
      })
    );

export const webClientMetadata = (origin: string) => ({
  client_id: clientIdOf(origin),
  client_name: `${Brand.name} web`,
  client_uri: origin,
  grant_types: ["authorization_code"],
  redirect_uris: [redirectUriOf(origin)],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
});

export const clientMetadataHandler = ({ request }: Handled): Response =>
  Response.json(webClientMetadata(new URL(request.url).origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
