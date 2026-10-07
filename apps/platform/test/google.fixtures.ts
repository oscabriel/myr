/**
 * A fake Google for sign-in tests, behind the `Fetch` port: its discovery
 * document, its token endpoint and its keys (JWKS), signing ID tokens with
 * an RSA key the test made. A test plays Google's consent screen with
 * `consent`: it reads the authorization request the platform sent the
 * browser to, and answers with the callback URL Google would send it back
 * to, its code bound to the request's PKCE challenge and nonce.
 *
 * `googleWorld` is the sign-in Worker as `worker.ts` builds it, over the
 * fake env (Google's client set, unless a test says not), accounts and
 * links in memory and the fake Google, with a browser that keeps cookies.
 */
import { Fetch } from "@repo/artifacts/fetch";
import { untouchable } from "@repo/testkit/untouchable";
import { Clock, Effect, Layer, Option, Ref, Schema } from "effect";
import { vi } from "vitest";

import { Accounts } from "../src/auth/accounts.ts";
import { AccountsMemory } from "../src/auth/accounts/memory.ts";
import { SignInAttemptsMemory } from "../src/auth/attempts/memory.ts";
import { GOOGLE_DISCOVERY } from "../src/auth/google.ts";
import { Identities } from "../src/auth/identities.ts";
import { IdentitiesMemory } from "../src/auth/identities/memory.ts";
import { OAuthStore } from "../src/auth/oauth-store.ts";
import { OAuthStoreMemory } from "../src/auth/oauth-store/memory.ts";
import { oauthProvider, signInSettings } from "../src/auth/provider.ts";
import { decodeEnv } from "../src/platform.ts";
import { fakeEnv } from "./fake-env.ts";

/** The Google OAuth client every Google test signs in with (H4 makes the real one). */
export const clientId = "419-test.apps.googleusercontent.com";

export const clientSecret = "GOCSPX-a-test-client-secret";

export const tokenEndpoint = "https://oauth2.googleapis.com/token";

export const jwksUri = "https://www.googleapis.com/oauth2/v3/certs";

/** Google's two optional keys in the Worker's env (`.env.schema`). */
export type GoogleKey = "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET";

/** The Worker's env with Google's keys, which the generated `Env` leaves out (optional secrets). */
export type GoogleEnv = Env & Readonly<Partial<Record<GoogleKey, string>>>;

/** The fake env with the named halves of Google's client set (both by default). */
export const googleEnv = (
  keys: readonly GoogleKey[] = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
): GoogleEnv => {
  const halves = {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
  } as const;

  return {
    ...fakeEnv(),
    ...Object.fromEntries(keys.map((key) => [key, halves[key]])),
  };
};

const utf8 = (text: string) => new TextEncoder().encode(text);

const base64Url = Schema.encodeSync(Schema.Uint8ArrayFromBase64Url);

const rsa = { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" } as const;

const isKeyPair = (key: CryptoKey | CryptoKeyPair): key is CryptoKeyPair =>
  "privateKey" in key;

const isJwk = (key: ArrayBuffer | JsonWebKey): key is JsonWebKey =>
  !(key instanceof ArrayBuffer);

/** A fresh RS256 key pair, its public half as a JWK under `kid`. */
const keyPair = (kid: string) =>
  Effect.gen(function* () {
    const pair = yield* Effect.promise(() =>
      crypto.subtle.generateKey(
        {
          ...rsa,
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
        },
        true,
        ["sign", "verify"]
      )
    ).pipe(Effect.filterOrFail(isKeyPair), Effect.orDie);

    const jwk = yield* Effect.promise(() =>
      crypto.subtle.exportKey("jwk", pair.publicKey)
    ).pipe(Effect.filterOrFail(isJwk), Effect.orDie);

    return {
      kid,
      privateKey: pair.privateKey,
      publicJwk: {
        alg: "RS256",
        e: jwk.e,
        kid,
        kty: "RSA",
        n: jwk.n,
        use: "sig",
      },
    };
  });

export type KeyPair = Effect.Success<ReturnType<typeof keyPair>>;

/**
 * How Google answers one code: the person (`sub`), and anything a test
 * changes about the ID token: its claims, the key it is signed with, or the
 * `kid` its header names.
 */
/** The ID token claims a test may change, beside the subject. */
export interface Claims {
  readonly aud?: string;
  readonly exp?: number;
  readonly iss?: string;
  readonly nonce?: string;
}

export interface Consent {
  readonly claims?: Claims;
  readonly kid?: string;
  readonly signWith?: KeyPair;
  readonly sub: string;
}

/** What the platform asked Google for, as Google's consent screen reads it. */
const AuthorizationRequest = Schema.Struct({
  client_id: Schema.String,
  code_challenge: Schema.String,
  code_challenge_method: Schema.Literal("S256"),
  nonce: Schema.String,
  redirect_uri: Schema.String,
  response_type: Schema.Literal("code"),
  scope: Schema.Literal("openid"),
  state: Schema.String,
});

const decodeAuthorizationRequest =
  Schema.decodeUnknownSync(AuthorizationRequest);

/** The code exchange the platform posts to the token endpoint. */
const CodeExchange = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.String,
  code: Schema.String,
  code_verifier: Schema.String,
  grant_type: Schema.Literal("authorization_code"),
  redirect_uri: Schema.String,
});

const decodeCodeExchange = Schema.decodeUnknownOption(CodeExchange);

interface Grant {
  readonly consent: Consent;
  readonly request: typeof AuthorizationRequest.Type;
}

/** The S256 challenge of `verifier`. */
const s256 = (verifier: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", utf8(verifier))).pipe(
    Effect.map((digest) => base64Url(new Uint8Array(digest)))
  );

/** A fake Google for one test, and what it was asked. */
export const fakeGoogle = Effect.gen(function* () {
  const signing = yield* keyPair("google-key-1");

  const published = yield* Ref.make<readonly KeyPair[]>([signing]);

  const grants = yield* Ref.make(new Map<string, Grant>());

  const fetched = yield* Ref.make<readonly string[]>([]);

  const exchanges = yield* Ref.make<readonly string[]>([]);

  /** An ID token for `grant`, signed as `grant.consent` says. */
  const idToken = (grant: Grant) =>
    Effect.gen(function* () {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);

      const { consent } = grant;

      const key = consent.signWith ?? signing;

      const header = base64Url(
        utf8(
          JSON.stringify({
            alg: "RS256",
            kid: consent.kid ?? key.kid,
            typ: "JWT",
          })
        )
      );

      const claims = base64Url(
        utf8(
          JSON.stringify({
            aud: clientId,
            azp: clientId,
            exp: now + 3600,
            iat: now,
            iss: "https://accounts.google.com",
            nonce: grant.request.nonce,
            sub: consent.sub,
            ...consent.claims,
          })
        )
      );

      const signature = yield* Effect.promise(() =>
        crypto.subtle.sign(rsa, key.privateKey, utf8(`${header}.${claims}`))
      );

      return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
    });

  /** Google's token endpoint: the code, its client and its PKCE verifier, or `invalid_grant`. */
  const token = (request: Request) =>
    Effect.gen(function* () {
      const form = Object.fromEntries(
        new URLSearchParams(yield* Effect.promise(() => request.text()))
      );

      yield* Ref.update(exchanges, (all) => [...all, form.code ?? ""]);

      const exchange = decodeCodeExchange(form);

      const known = yield* Ref.get(grants);

      const grant = Option.flatMap(exchange, ({ code }) =>
        Option.fromUndefinedOr(known.get(code))
      );

      if (Option.isNone(exchange) || Option.isNone(grant)) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      const challenge = yield* s256(exchange.value.code_verifier);

      const matches =
        exchange.value.client_id === clientId &&
        exchange.value.client_secret === clientSecret &&
        exchange.value.redirect_uri === grant.value.request.redirect_uri &&
        challenge === grant.value.request.code_challenge;

      if (!matches) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      yield* Ref.update(grants, (all) => {
        const left = new Map(all);

        left.delete(exchange.value.code);

        return left;
      });

      return Response.json({
        access_token: "ya29.a-google-access-token",
        expires_in: 3599,
        id_token: yield* idToken(grant.value),
        scope: "openid",
        token_type: "Bearer",
      });
    });

  const fetch = Fetch.of({
    fetch: (request) =>
      Effect.gen(function* () {
        yield* Ref.update(fetched, (all) => [...all, request.url]);

        if (request.url === GOOGLE_DISCOVERY) {
          return Response.json({
            authorization_endpoint:
              "https://accounts.google.com/o/oauth2/v2/auth",
            code_challenge_methods_supported: ["plain", "S256"],
            id_token_signing_alg_values_supported: ["RS256"],
            issuer: "https://accounts.google.com",
            jwks_uri: jwksUri,
            token_endpoint: tokenEndpoint,
          });
        }

        if (request.url === jwksUri) {
          const keys = yield* Ref.get(published);

          return Response.json({
            keys: keys.map(({ publicJwk }) => publicJwk),
          });
        }

        if (request.url === tokenEndpoint && request.method === "POST") {
          return yield* token(request);
        }

        return new Response("not found", { status: 404 });
      }),
  });

  /**
   * Google's consent screen: the person `consent.sub` signs in for the
   * authorization request at `location`, and Google sends the browser back
   * to its redirect URI with a code and the request's `state`.
   */
  const consent = (location: string, given: Consent) =>
    Effect.gen(function* () {
      const request = decodeAuthorizationRequest(
        Object.fromEntries(new URL(location).searchParams)
      );

      const code = `code-${(yield* Ref.get(grants)).size + 1}-${given.sub}`;

      yield* Ref.update(grants, (all) =>
        new Map(all).set(code, { consent: given, request })
      );

      const back = new URL(request.redirect_uri);

      back.searchParams.set("code", code);
      back.searchParams.set("state", request.state);

      return back;
    });

  /** Google starts signing with a new key, and publishes it beside the old one. */
  const rotate = (kid: string) =>
    Effect.gen(function* () {
      const next = yield* keyPair(kid);

      yield* Ref.update(published, (keys) => [...keys, next]);

      return next;
    });

  /** How many times a URL was fetched. */
  const timesFetched = (url: string) =>
    Ref.get(fetched).pipe(
      Effect.map((all) => all.filter((each) => each === url).length)
    );

  return {
    consent,
    exchanges: Ref.get(exchanges),
    fetch,
    keyPair,
    rotate,
    timesFetched,
  };
});

export type FakeGoogle = Effect.Success<typeof fakeGoogle>;

/** Where a request comes from, as a browser decides which cookies go with it. */
export type Site = "cross-site" | "same-site";

interface Kept {
  readonly strict: boolean;
  readonly value: string;
}

/**
 * A browser for `handler`: it keeps the cookies responses set (dropping one
 * set with `Max-Age=0`) and sends them back, except that a `SameSite=Strict`
 * cookie stays home on a request from another site, as Google's redirect
 * back to the callback is.
 */
const browserFor = (handler: (request: Request) => Promise<Response>) => {
  const jar = new Map<string, Kept>();

  const send = (request: Request, from: Site = "same-site") =>
    Effect.gen(function* () {
      const headers = new Headers(request.headers);

      const cookies = [...jar].flatMap(([name, kept]) =>
        from === "same-site" || !kept.strict ? [`${name}=${kept.value}`] : []
      );

      if (cookies.length > 0) {
        headers.set("cookie", cookies.join("; "));
      }

      const response = yield* Effect.promise(() =>
        handler(new Request(request, { headers, redirect: "manual" }))
      );

      for (const line of response.headers.getSetCookie()) {
        const [pair = "", ...attributes] = line
          .split(";")
          .map((part) => part.trim());

        const [name = "", value = ""] = pair.split("=");

        const lowered = new Set(
          attributes.map((attribute) => attribute.toLowerCase())
        );

        if (lowered.has("max-age=0")) {
          jar.delete(name);
        } else {
          jar.set(name, { strict: lowered.has("samesite=strict"), value });
        }
      }

      return response;
    });

  return {
    cookie: (name: string) => Option.fromUndefinedOr(jar.get(name)?.value),
    send,
  };
};

/** A Worker's context the provider is handed and never needs. */
const context = untouchable<ExecutionContext>("ExecutionContext");

/** What the rest of the platform answers: only the auth routes are sign-in's. */
const platformFetch = (request: Request) =>
  Promise.resolve(
    new Response(`platform: ${new URL(request.url).pathname}`, { status: 418 })
  );

/**
 * The sign-in Worker with Google's client set (or not, `google: false`), and
 * `COOKIE_KEY` as the fake env has it unless a test names another. The
 * global `fetch` answers the CLI's client metadata document from the Worker
 * itself, as the public internet does on Cloudflare; Google is reached only
 * through the `Fetch` port.
 */
export const googleWorld = (
  options: { readonly cookieKey?: string; readonly google?: boolean } = {}
) =>
  Effect.gen(function* () {
    const google = yield* fakeGoogle;

    const withGoogle = googleEnv(options.google === false ? [] : undefined);

    const env =
      options.cookieKey === undefined
        ? withGoogle
        : { ...withGoogle, COOKIE_KEY: options.cookieKey };

    const config = yield* decodeEnv(env).pipe(Effect.orDie);

    const accounts = yield* Effect.provide(
      Effect.service(Accounts),
      AccountsMemory.layer
    );

    const identities = yield* Effect.provide(
      Effect.service(Identities),
      IdentitiesMemory.layer
    );

    const store = OAuthStoreMemory.make();

    const { dispose, handler } = oauthProvider(
      Layer.mergeAll(
        Layer.succeed(Accounts, accounts),
        Layer.succeed(Identities, identities),
        Layer.succeed(OAuthStore, store),
        Layer.succeed(Fetch, google.fetch),
        SignInAttemptsMemory.layer,
        signInSettings(config)
      ),
      platformFetch
    );

    const handle = (request: Request) =>
      Promise.resolve(handler.fetch(request, fakeEnv(), context));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        vi.stubGlobal("Cloudflare", {
          compatibilityFlags: { global_fetch_strictly_public: true },
        });
        vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
          handle(new Request(input))
        );
      }),
      () =>
        Effect.promise(dispose).pipe(
          Effect.andThen(Effect.sync(() => vi.unstubAllGlobals()))
        )
    );

    return { accounts, browser: browserFor(handle), google, identities, store };
  });

export type GoogleWorld = Effect.Success<ReturnType<typeof googleWorld>>;
