import { Brand } from "@repo/brand";
import { Upstream } from "@repo/git/upstream";
import { Projects } from "@repo/project/projects";
import { authenticated, bearerToken } from "@repo/protocol/authenticate";
import { Client, Contracts, surfaced } from "@repo/protocol/contracts";
import { toToolkit } from "@repo/protocol/mcp";
import { Authenticated } from "@repo/protocol/principal";
import { Context, Effect, Layer, Option } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import {
  Headers,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import type { Rpc, RpcGroup } from "effect/rpc";
import {
  RpcMiddleware,
  RpcSerialization,
  RpcServer,
  RpcTest,
} from "effect/rpc";

import { serveGit } from "./git.ts";
import type { GitServices } from "./git.ts";
import { Sessions } from "./sessions.ts";

/** Which stage this Worker serves: `/health` says so. */
export class Stage extends Context.Service<Stage, { readonly name: string }>()(
  "platform/Stage"
) {}

/**
 * What the surfaces need from the platform: the contracts' handlers,
 * sessions, what git's paths need, and the stage.
 */
export type Services =
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>
  | Sessions
  | GitServices
  | Stage;

/** git's smart-HTTP paths: `/<repo>(.git)/info/refs` and the two services. */
const GIT_PATH =
  /^\/[A-Za-z0-9._-]+\/(?:info\/refs|git-upload-pack|git-receive-pack)$/u;

/**
 * Paths no credential is asked for: `/health`, and git's, whose gateway
 * decides who may read and push.
 */
const isExempt = (url: string) => {
  const [path = url] = url.split("?");

  return path === "/health" || GIT_PATH.test(path);
};

/** The person an `Authorization` header names, if any. */
const principalOf = (sessions: Sessions["Service"], authorization?: string) =>
  Option.match(bearerToken(authorization), {
    onNone: () => Effect.succeedNone,
    onSome: (token) => sessions.verify(token),
  });

/**
 * Every request but `/health` and git's needs a credential the platform
 * knows; anything else gets a 401 that asks for a bearer token, before any
 * surface sees it.
 */
const requireCredential = HttpRouter.middleware(
  Effect.gen(function* () {
    const sessions = yield* Sessions;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        if (isExempt(request.url)) {
          return yield* httpEffect;
        }

        const principal = yield* principalOf(
          sessions,
          request.headers.authorization
        );

        if (Option.isNone(principal)) {
          return HttpServerResponse.empty({
            headers: { "www-authenticate": "Bearer" },
            status: 401,
          });
        }

        return yield* httpEffect;
      });
  }),
  { global: true }
);

/**
 * Server side: a call runs as the person its credential names. A call with no
 * credential runs as anyone only on a `public` contract; the 401 gate above
 * turns those away until anonymous reads open.
 */
const verifyCredential = authenticated((credential) =>
  Sessions.use(({ verify }) => verify(credential))
);

/**
 * Client side, for calls made while serving an HTTP request: the call carries
 * that request's credential.
 */
const forwardCredential = RpcMiddleware.layerClient(
  Authenticated,
  ({ next, request }) =>
    Effect.gen(function* () {
      const incoming = yield* Effect.serviceOption(
        HttpServerRequest.HttpServerRequest
      );

      const authorization = Option.flatMapNullishOr(
        incoming,
        ({ headers }) => headers.authorization
      );

      return yield* next(
        Option.match(authorization, {
          onNone: () => request,
          onSome: (value) => ({
            ...request,
            headers: Headers.set(request.headers, "authorization", value),
          }),
        })
      );
    })
);

const projection = toToolkit(surfaced("mcp"), Effect.service(Client));

/**
 * The MCP-surfaced contracts as tools at `/mcp`, each call made as the
 * caller.
 */
const mcp = McpServer.toolkit(projection.toolkit).pipe(
  Layer.provideMerge(projection.layer),
  Layer.provide(Layer.effect(Client, RpcTest.makeClient(Contracts))),
  Layer.provide([verifyCredential, forwardCredential]),
  Layer.provide(
    McpServer.layerHttp({
      name: Brand.name,
      path: "/mcp",
      protocols: [McpProtocol.v2026_07_28],
      version: "0.0.0",
    })
  )
);

/** The contracts over HTTP at `/rpc`, for the CLI and anything else remote. */
const rpc = RpcServer.layerHttp({
  group: Contracts,
  path: "/rpc",
  protocol: "http",
}).pipe(Layer.provide([verifyCredential, RpcSerialization.layerJson]));

/** `/health`: the Worker is up, and which stage it serves. */
const health = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const { name } = yield* Stage;

    yield* router.add(
      "GET",
      "/health",
      HttpServerResponse.jsonUnsafe({ ok: true, stage: name })
    );
  })
);

/** A git request, as the gateway answers it; 404 for a path it does not serve. */
const toGateway = (request: HttpServerRequest.HttpServerRequest) =>
  HttpServerRequest.toWeb(request).pipe(
    Effect.flatMap((web) =>
      Option.match(serveGit(web), {
        onNone: () => Effect.succeed(HttpServerResponse.empty({ status: 404 })),
        onSome: Effect.map(HttpServerResponse.fromWeb),
      })
    ),
    Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 400 }))
  );

const GIT_ROUTES = [
  "/:repo/info/refs",
  "/:repo/git-upload-pack",
  "/:repo/git-receive-pack",
] as const;

/**
 * git's smart-HTTP paths, each handed to the gateway with the services it
 * needs, taken once when the router is built.
 */
const git = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(Sessions, yield* Sessions).pipe(
      Context.add(Projects, yield* Projects),
      Context.add(Upstream, yield* Upstream)
    );

    for (const path of GIT_ROUTES) {
      yield* router.add("*", path, (request) =>
        Effect.provide(toGateway(request), services)
      );
    }
  })
);

/** The platform's fetch handler over `services`. */
export const serve = <E>(services: Layer.Layer<Services, E>) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(health, git, mcp, rpc, requireCredential).pipe(
      Layer.provide(services)
    ),
    { disableLogger: true }
  );
