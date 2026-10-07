import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { toToolkit } from "@repo/protocol/mcp";
import {
  Authenticated,
  CurrentPrincipal,
  Unauthenticated,
} from "@repo/protocol/principal";
import { Effect, Layer, Option } from "effect";
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

import { Sessions } from "./sessions.ts";

/** What the surfaces need from the platform: the contracts' handlers and sessions. */
export type Services =
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>
  | Sessions;

/** The token in an `Authorization: Bearer <token>` header. */
const bearer = (authorization: string | undefined) =>
  /^Bearer (?<token>\S+)$/u.exec(authorization ?? "")?.groups?.token;

/** The person an `Authorization` header names, if any. */
const principalOf = (sessions: Sessions["Service"], authorization?: string) => {
  const token = bearer(authorization);

  return token === undefined ? Effect.succeedNone : sessions.verify(token);
};

/**
 * Every request needs a credential the platform knows; anything else gets a
 * 401 that asks for a bearer token, before any surface sees it.
 */
const requireCredential = HttpRouter.middleware(
  Effect.gen(function* () {
    const sessions = yield* Sessions;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

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

/** Server side: a call runs as the person its credential names, or not at all. */
const verifyCredential = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const sessions = yield* Sessions;

    return (effect, { headers }) =>
      Effect.gen(function* () {
        const principal = yield* principalOf(sessions, headers.authorization);

        if (Option.isNone(principal)) {
          return yield* new Unauthenticated();
        }

        return yield* Effect.provideService(
          effect,
          CurrentPrincipal,
          principal.value
        );
      });
  })
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

const projection = toToolkit(Contracts, Effect.service(Client));

/** The contracts as MCP tools at `/mcp`, each call made as the caller. */
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

/** The platform's fetch handler over `services`. */
export const serve = (services: Layer.Layer<Services>) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(mcp, rpc, requireCredential).pipe(Layer.provide(services)),
    { disableLogger: true }
  );
