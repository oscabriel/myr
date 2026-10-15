import { Fetch } from "@repo/artifacts/fetch";
import { untouchable } from "@repo/testkit/untouchable";
import { Clock, Effect, Layer, Option, Schema } from "effect";
import { vi } from "vitest";

import { Accounts } from "../src/auth/accounts.ts";
import { AccountsMemory } from "../src/auth/accounts/memory.ts";
import { SignInAttemptsMemory } from "../src/auth/attempts/memory.ts";
import { cliClientId } from "../src/auth/cli-client.ts";
import { IdentitiesMemory } from "../src/auth/identities/memory.ts";
import { MailerMemory } from "../src/auth/mailer/memory.ts";
import { OAuthStore } from "../src/auth/oauth-store.ts";
import { OAuthStoreMemory } from "../src/auth/oauth-store/memory.ts";
import { oauthProvider, signInSettings } from "../src/auth/provider.ts";
import { decodeEnv } from "../src/platform.ts";
import { fakeEnv } from "./fake-env.ts";

export const origin = "https://platform.test";

export const cliClient = cliClientId(origin);

export const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

export const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

export const port = 43_123;

export const redirectUri = `http://127.0.0.1:${port}/callback`;

export const namedPerson = "carol";

const worldEnv = () => ({
  ...fakeEnv(),
  SESSION_TOKENS: JSON.stringify({
    "carol-token-0123456789abcdef01234567": namedPerson,
  }),
});

const context = untouchable<ExecutionContext>("ExecutionContext");

const platformFetch = (request: Request) =>
  Promise.resolve(
    new Response(`platform: ${new URL(request.url).pathname}`, { status: 418 })
  );

const decodeTokenRecord = Schema.decodeUnknownEffect(
  Schema.Record(Schema.String, Schema.Unknown)
);

export const signInWorld = (options: { readonly mailFails?: boolean } = {}) =>
  Effect.gen(function* () {
    const config = yield* decodeEnv(worldEnv()).pipe(Effect.orDie);

    const accounts = yield* Effect.provide(
      Effect.service(Accounts),
      AccountsMemory.layer
    );

    const store = OAuthStoreMemory.make();

    const mailer = yield* MailerMemory.make({
      failing: options.mailFails === true,
    });

    const services = Layer.mergeAll(
      Layer.succeed(Accounts, accounts),
      mailer.layer,
      Layer.succeed(OAuthStore, store),
      IdentitiesMemory.layer,
      Layer.succeed(Fetch, untouchable<Fetch["Service"]>("Fetch")),
      SignInAttemptsMemory.layer,
      signInSettings(config)
    );

    const { dispose, handler } = oauthProvider(services, platformFetch);

    const send = (request: Request) =>
      handler.fetch(request, fakeEnv(), context);

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

    return { accounts, expireTokens, fetch, mails: mailer.sent, store };
  });

export type World = Effect.Success<ReturnType<typeof signInWorld>>;

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

// Each directive's sources, by name: a source counts only under the directive it was written in.
export const cspOf = (response: Response) =>
  Object.fromEntries(
    (response.headers.get("content-security-policy") ?? "")
      .split(";")
      .map((directive) => directive.trim().split(/\s+/u))
      .filter(([name]) => name !== undefined && name !== "")
      .map(([name = "", ...sources]) => [name, sources])
  );

export const codeOf = (response: Response) =>
  Option.fromNullishOr(response.headers.get("location")).pipe(
    Option.flatMap((location) => Option.fromNullishOr(URL.parse(location))),
    Option.filter((url) => url.origin === new URL(redirectUri).origin),
    Option.flatMap((url) => Option.fromNullishOr(url.searchParams.get("code")))
  );

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
