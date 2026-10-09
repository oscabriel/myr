/**
 * The platform as its own OAuth authorization server, in front of the rest
 * of the platform: `@cloudflare/workers-oauth-provider` 1.2.1 answers its
 * metadata and `/token`, storing grants in `OAUTH_KV`; sign-in's pages
 * answer `/authorize`, `/signup` and the CLI's client metadata document,
 * and Google sign-in's answer `/oauth/google/*` when the platform has a
 * Google OAuth client; every other request goes to the
 * platform's own fetch untouched.
 *
 * The provider's role-based `OAuthAuthorizationServer` is used, not its
 * combined `OAuthProvider`: that one requires an `apiRoute` whose bearer
 * tokens it checks itself (its constructor throws without one), while here
 * one `Sessions` checks every token (`adapters/sessions-oauth.ts`).
 */
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

/**
 * The authorization server for one origin: the origin is its issuer and
 * its one resource, as the protected resource metadata names it, so
 * a token is good for every path the platform serves there. The CLI's and
 * an MCP client's Client ID Metadata Documents are fetched (the Worker
 * needs `global_fetch_strictly_public`); nothing registers dynamically.
 */
const authorizationServerFor = (origin: string) =>
  new OAuthAuthorizationServer<OAuthEnv>({
    authorizeEndpoint: "/authorize",
    clientIdMetadataDocumentEnabled: true,
    issuer: origin,
    resources: [origin],
    tokenEndpoint: "/token",
  });

/**
 * Whether the provider or sign-in's pages answer `path`. Google's paths
 * are sign-in's whether or not Google is offered: without a Google client
 * no route serves them, and they answer 404.
 */
const answersHere = (path: string) =>
  [
    ...AUTHORIZATION_SERVER_PATHS,
    ...SIGN_IN_PATHS,
    ...Object.values(GOOGLE_PATHS),
  ].some((owned) => owned === path);

/** What the platform answers everything else with. */
export type PlatformFetch = (
  request: Request,
  env: Env,
  context: ExecutionContext
) => Promise<Response>;

/**
 * The Worker's fetch: OAuth and sign-in in front of `platformFetch`. The
 * sign-in routes are built once from `services`, now, awaiting nothing
 * (`router-build.ts`; a failure to build them answers 500 on those paths
 * only); each origin's authorization server is
 * made on its first request and kept for the isolate's life (a Worker is
 * reached only on its own hostnames).
 */
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

/**
 * Reads the provider's access tokens from `store`, for `OAuthSessions`.
 * Unwrapping reads only the token's record and the token itself (1.2.1's
 * `unwrapToken`; the server's issuer and resources are never consulted),
 * so one reader serves every origin; its loopback issuer is a placeholder.
 */
export const tokenReader = (store: OAuthStore["Service"]): TokenReader => {
  const api = authorizationServerFor("http://localhost").getOAuthApi({
    OAUTH_KV: store,
  });

  return { unwrapToken: (token) => api.unwrapToken(token) };
};

/** Google's OAuth client from the decoded env: both halves, or none. */
const googleClientOf = (config: PlatformConfig) =>
  Option.all({
    id: Option.fromUndefinedOr(config.GOOGLE_CLIENT_ID),
    secret: Option.fromUndefinedOr(config.GOOGLE_CLIENT_SECRET),
  });

/**
 * Sign-in's settings from the decoded env: its two secrets, the handles
 * the operator and `SESSION_TOKENS` already hold, which nobody signs up as,
 * and Google's OAuth client, offered on the sign-in page when it is set.
 */
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

/**
 * Sign-in's services on Cloudflare: the settings from the decoded env,
 * accounts and Google links in the `FRONT_PAGE` D1 database
 * (`migrations/0002_accounts.sql`, `0003_identities.sql`), attempts counted
 * by `SIGN_IN_LIMIT`, grants in `OAUTH_KV`, and Google reached through the
 * Worker's `fetch`.
 */
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
    Layer.succeed(OAuthStore, config.OAUTH_KV),
    WorkerFetch
  );
