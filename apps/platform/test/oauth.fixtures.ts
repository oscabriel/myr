/**
 * A platform Worker for sign-in tests: the OAuth provider over an in-memory
 * `OAUTH_KV`, accounts and sign-in attempts in their `/memory` adapters,
 * and a stand-in for the rest of the platform. The provider fetches a
 * client's metadata document through the global `fetch`; here the Worker
 * itself answers it, as the public internet does on Cloudflare.
 */
import { Fetch } from "@repo/artifacts/fetch";
import { untouchable } from "@repo/testkit/untouchable";
import { Clock, Effect, Layer, Option, Schema } from "effect";
import { vi } from "vitest";

import { Accounts } from "../src/auth/accounts.ts";
import { AccountsMemory } from "../src/auth/accounts/memory.ts";
import { SignInAttemptsMemory } from "../src/auth/attempts/memory.ts";
import { cliClientId } from "../src/auth/cli-client.ts";
import { IdentitiesMemory } from "../src/auth/identities/memory.ts";
import { OAuthStore } from "../src/auth/oauth-store.ts";
import { OAuthStoreMemory } from "../src/auth/oauth-store/memory.ts";
import { oauthProvider, signInSettings } from "../src/auth/provider.ts";
import { decodeEnv } from "../src/platform.ts";
import { fakeEnv } from "./fake-env.ts";

export const origin = "https://platform.test";

export const cliClient = cliClientId(origin);

/** RFC 7636 appendix B's verifier and its S256 challenge. */
export const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

export const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

export const port = 43_123;

export const redirectUri = `http://127.0.0.1:${port}/callback`;

/** A person a named session holds (spec §8 D9), in the world's `SESSION_TOKENS`. */
export const namedPerson = "carol";

/** The fake env with one named session, as the demo's stages run. */
const worldEnv = () => ({
  ...fakeEnv(),
  SESSION_TOKENS: JSON.stringify({
    "carol-token-0123456789abcdef01234567": namedPerson,
  }),
});

/** A Worker's context the provider is handed and never needs. */
const context = untouchable<ExecutionContext>("ExecutionContext");

/** What the rest of the platform answers: only the auth routes are the provider's. */
const platformFetch = (request: Request) =>
  Promise.resolve(
    new Response(`platform: ${new URL(request.url).pathname}`, { status: 418 })
  );

/** A stored access token record, kept whole while its expiry is moved. */
const decodeTokenRecord = Schema.decodeUnknownEffect(
  Schema.Record(Schema.String, Schema.Unknown)
);

/**
 * The sign-in Worker, its store and its accounts, for one test. The global
 * `fetch` and the compatibility flag CIMD needs are stubbed for the test's
 * length.
 */
export const signInWorld = Effect.gen(function* () {
  const config = yield* decodeEnv(worldEnv()).pipe(Effect.orDie);

  const accounts = yield* Effect.provide(
    Effect.service(Accounts),
    AccountsMemory.layer
  );

  const store = OAuthStoreMemory.make();

  // Google sign-in is off here (no Google client), so it reaches neither
  // its links nor Google (W4 419).
  const services = Layer.mergeAll(
    Layer.succeed(Accounts, accounts),
    Layer.succeed(OAuthStore, store),
    IdentitiesMemory.layer,
    Layer.succeed(Fetch, untouchable<Fetch["Service"]>("Fetch")),
    SignInAttemptsMemory.layer,
    signInSettings(config)
  );

  const { dispose, handler } = oauthProvider(services, platformFetch);

  const send = (request: Request) => handler.fetch(request, fakeEnv(), context);

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      vi.stubGlobal("Cloudflare", {
        compatibilityFlags: { global_fetch_strictly_public: true },
      });
      vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
        send(new Request(input))
      );
    }),
    () =>
      Effect.promise(dispose).pipe(
        Effect.andThen(Effect.sync(() => vi.unstubAllGlobals()))
      )
  );

  const fetch = (request: Request) => Effect.promise(() => send(request));

  /** Every access token in the store, made to have expired a second ago. */
  const expireTokens = Effect.gen(function* () {
    const { keys } = yield* Effect.promise(() =>
      store.list({ prefix: "token:" })
    );

    const now = yield* Clock.currentTimeMillis;

    for (const { metadata, name } of keys) {
      const token = yield* Effect.promise(() =>
        store.get(name, { type: "json" })
      ).pipe(Effect.flatMap(decodeTokenRecord), Effect.orDie);

      yield* Effect.promise(() =>
        store.put(
          name,
          JSON.stringify({ ...token, expiresAt: Math.floor(now / 1000) - 1 }),
          { metadata }
        )
      );
    }
  });

  return { accounts, expireTokens, fetch, store };
});

export type World = Effect.Success<typeof signInWorld>;

/** The hidden fields and the CSRF cookie a sign-in page hands the browser. */
export interface SignInForm {
  readonly cookie: string;
  readonly csrf: string;
  readonly request: string;
}

const field = (html: string, name: string) =>
  Option.fromNullishOr(
    new RegExp(`name="${name}" value="(?<value>[^"]*)"`, "u").exec(html)?.groups
      ?.value
  );

/** The form a page carries, read as a browser would; `cookie` is the one it already holds. */
export const formOf = (
  response: Response,
  html: string,
  cookie?: string
): Option.Option<SignInForm> =>
  Option.all({
    cookie: Option.orElse(
      Option.fromNullishOr(
        /__Host-sign-in=(?<value>[^;]+)/u.exec(
          response.headers.get("set-cookie") ?? ""
        )?.groups?.value
      ),
      () => Option.fromNullishOr(cookie)
    ),
    csrf: field(html, "csrf"),
    request: field(html, "request"),
  });

/** The code a response sends the CLI's loopback, if it redirects there with one. */
export const codeOf = (response: Response) =>
  Option.fromNullishOr(response.headers.get("location")).pipe(
    Option.flatMap((location) => Option.fromNullishOr(URL.parse(location))),
    Option.filter((url) => url.origin === new URL(redirectUri).origin),
    Option.flatMap((url) => Option.fromNullishOr(url.searchParams.get("code")))
  );

/** The authorization request the CLI opens in a browser. */
export const authorizeUrl = (state = "state-1", redirect = redirectUri) => {
  const url = new URL("/authorize", origin);

  for (const [name, value] of Object.entries({
    client_id: cliClient,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirect,
    response_type: "code",
    state,
  })) {
    url.searchParams.set(name, value);
  }

  return url;
};

/** A browser's form post: the fields, the CSRF cookie and the client's address. */
export const post = (
  path: string,
  fields: Readonly<Record<string, string>>,
  cookie: string,
  address = "198.51.100.7"
) =>
  new Request(new URL(path, origin), {
    body: new URLSearchParams(fields),
    headers: {
      "cf-connecting-ip": address,
      "content-type": "application/x-www-form-urlencoded",
      cookie: `__Host-sign-in=${cookie}`,
    },
    method: "POST",
    redirect: "manual",
  });

/** The token request the CLI makes with its code and verifier. */
export const tokenRequest = (code: string, codeVerifier = verifier) =>
  new Request(new URL("/token", origin), {
    body: new URLSearchParams({
      client_id: cliClient,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
