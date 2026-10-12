// The role-based server, not `OAuthProvider`: that one requires an `apiRoute` whose tokens it checks itself.
import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { D1Client } from "@effect/sql-d1";
import { Context, Layer, Option, Redacted } from "effect";

import { AccountsD1 } from "../adapters/accounts-d1.ts";
import { WorkerFetch } from "../adapters/fetch.ts";
import { IdentitiesD1 } from "../adapters/identities-d1.ts";
import type { TokenReader } from "../adapters/sessions-oauth.ts";
import type { PlatformConfig } from "../platform.ts";
import { buildHandler } from "../router-build.ts";
import { SignInAttemptsBinding } from "./attempts/binding.ts";
import { GOOGLE_ACCOUNTS, GoogleClient, googleRoutes } from "./google.ts";
import type { GoogleServices } from "./google.ts";
import { MailerBinding } from "./mailer/binding.ts";
import { OAuthStore } from "./oauth-store.ts";
import { GOOGLE_PATHS } from "./pages.ts";
import {
  Authorization,
  AUTHORIZATION_SERVER_PATHS,
  HeldHandles,
  SIGN_IN_PATHS,
  SignInKeys,
  SignInOffers,
  signInRoutes,
} from "./sign-in.ts";
import type { OAuthEnv } from "./sign-in.ts";

// Client ID Metadata Documents are fetched, so the Worker needs `global_fetch_strictly_public`.
const authorizationServerFor = (origin: string) =>
  new OAuthAuthorizationServer<OAuthEnv>({
    authorizeEndpoint: "/authorize",
    clientIdMetadataDocumentEnabled: true,
    issuer: origin,
    resources: [origin],
    tokenEndpoint: "/token",
  });

// Google's paths are sign-in's even with no Google client: no route serves them, so they answer 404.
const answersHere = (path: string) =>
  [
    ...AUTHORIZATION_SERVER_PATHS,
    ...SIGN_IN_PATHS,
    ...Object.values(GOOGLE_PATHS),
  ].some((owned) => owned === path);

export type PlatformFetch = (
  request: Request,
  env: Env,
  context: ExecutionContext
) => Promise<Response>;

// Each origin's server is made on its first request and kept: a Worker is reached only on its own hostnames.
export const oauthProvider = <E>(
  services: Layer.Layer<GoogleServices, E>,
  platformFetch: PlatformFetch
) => {
  const { dispose, handler } = buildHandler(
    Layer.mergeAll(signInRoutes, googleRoutes).pipe(Layer.provide(services))
  );

  const servers = new Map<string, OAuthAuthorizationServer<OAuthEnv>>();

  const serverFor = (origin: string) => {
    const known = servers.get(origin);

    if (known !== undefined) {
      return known;
    }

    const made = authorizationServerFor(origin);

    servers.set(origin, made);

    return made;
  };

  const fetch: PlatformFetch = (request, env, context) => {
    const { origin, pathname } = new URL(request.url);

    return answersHere(pathname)
      ? handler(
          request,
          Context.make(
            Authorization,
            Authorization.of({ context, origin, server: serverFor(origin) })
          )
        )
      : platformFetch(request, env, context);
  };

  return { dispose, handler: { fetch } satisfies ExportedHandler<Env> };
};

// Unwrapping never consults the issuer, so one reader serves every origin; its issuer is a placeholder.
export const tokenReader = (store: OAuthStore["Service"]): TokenReader => {
  const api = authorizationServerFor("http://localhost").getOAuthApi({
    OAUTH_KV: store,
  });

  return { unwrapToken: (token) => api.unwrapToken(token) };
};

const googleClientOf = (config: PlatformConfig) =>
  Option.all({
    id: Option.fromUndefinedOr(config.GOOGLE_CLIENT_ID),
    secret: Option.fromUndefinedOr(config.GOOGLE_CLIENT_SECRET),
  });

export const signInSettings = (config: PlatformConfig) =>
  Layer.mergeAll(
    Layer.succeed(
      GoogleClient,
      GoogleClient.of({ client: googleClientOf(config) })
    ),
    Layer.succeed(
      SignInOffers,
      SignInOffers.of({
        google: Option.as(googleClientOf(config), GOOGLE_ACCOUNTS),
      })
    ),
    Layer.succeed(
      SignInKeys,
      SignInKeys.of({
        cookieKey: config.COOKIE_KEY,
        pepper: config.PASSWORD_PEPPER,
      })
    ),
    Layer.succeed(
      HeldHandles,
      HeldHandles.of({
        handles: [
          config.OPERATOR_HANDLE,
          ...Option.match(Option.fromUndefinedOr(config.SESSION_TOKENS), {
            onNone: () => [],
            onSome: (table) => Object.values(Redacted.value(table)),
          }),
        ],
      })
    )
  );

export const signInServices = (
  config: PlatformConfig
): Layer.Layer<GoogleServices> =>
  Layer.mergeAll(
    signInSettings(config),
    Layer.mergeAll(AccountsD1, IdentitiesD1).pipe(
      Layer.provide(D1Client.layer({ db: config.FRONT_PAGE })),
      Layer.orDie
    ),
    SignInAttemptsBinding(config.SIGN_IN_LIMIT),
    MailerBinding(config.EMAIL),
    Layer.succeed(OAuthStore, config.OAUTH_KV),
    WorkerFetch
  );
