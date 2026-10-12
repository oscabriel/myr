import { commandDocs } from "@repo/agent-kit/command-doc";
import { platformSkillParts } from "@repo/agent-kit/platform";
import { RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { Upstream } from "@repo/git/upstream";
import { CodeStore } from "@repo/project/code-store";
import { CodeCache } from "@repo/project/code/cache";
import { FrontPage } from "@repo/project/front-page";
import { Projects } from "@repo/project/projects";
import { StandingPostures } from "@repo/project/standing-posture";
import { authenticated, bearerToken } from "@repo/protocol/authenticate";
import { Client, Contracts, surfaced } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import { toToolkit } from "@repo/protocol/mcp";
import { briefResources, skillPrompt } from "@repo/protocol/mcp-extras";
import { Authenticated } from "@repo/protocol/principal";
import type { Person } from "@repo/protocol/principal";
import { Context, Effect, Layer, Option, Schema } from "effect";
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
import { homeResponse } from "./home.ts";
import { HostInfo } from "./host-info.ts";
import { LayerGate } from "./layer-gate.ts";
import { rawResponse } from "./raw.ts";
import { releaseRoutes } from "./releases.ts";
import type { ReleaseStore } from "./releases.ts";
import { buildHandler } from "./router-build.ts";
import { Sessions } from "./sessions.ts";
import { isFramed } from "./watch.ts";
import { agentSkillRoutes } from "./well-known.ts";

export { HostInfo } from "./host-info.ts";

export class Stage extends Context.Service<Stage, { readonly name: string }>()(
  "platform/Stage"
) {}

export type Services =
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>
  | Sessions
  | GitServices
  | ReleaseStore
  | FrontPage
  | RepoHost
  | Stage
  | HostInfo;

const GIT_PATH =
  /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,2}\/(?:info\/refs|git-upload-pack|git-receive-pack)$/u;

const DISCOVERY_PATH =
  /^\/\.well-known\/oauth-(?:protected-resource|authorization-server)(?:\/.*)?$/u;

const SIGN_IN_PATH = /^\/(?:authorize|signup|token|oauth(?:\/.*)?)$/u;

// No git path, whose segment after the name is `info` or a git service, ever matches.
const RAW_PATH = /^\/[a-z0-9._-]+(?:\/[a-z0-9._-]+){0,2}\/raw\/.+$/u;

const RELEASE_PATH =
  /^\/(?:install\.sh|releases\/(?:manifest\.json|[^/]+\/[^/]+))$/u;

const SKILLS_PATH = /^\/\.well-known\/agent-skills\/.+$/u;

// No credential is asked for or checked on these, so none answers 401: git's gateway
// answers an unknown credential itself, and the rest may carry a stale token or an
// OAuth client's own credential.
const isExempt = (path: string) =>
  path === "/" ||
  path === "/health" ||
  RAW_PATH.test(path) ||
  GIT_PATH.test(path) ||
  DISCOVERY_PATH.test(path) ||
  SIGN_IN_PATH.test(path) ||
  RELEASE_PATH.test(path) ||
  SKILLS_PATH.test(path);

const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  URL.parse(request.originalUrl)?.origin ??
  Option.match(HttpServerRequest.toURL(request), {
    onNone: () => "http://localhost",
    onSome: ({ origin }) => origin,
  });

export const protectedResourceMetadata = (origin: string) => ({
  authorization_servers: [origin] as const,
  bearer_methods_supported: ["header"] as const,
  resource: origin,
});

// RFC 9728 §5.1, which MCP's authorization requires. `invalid_token` only for a
// bearer token the platform does not know (RFC 6750 §3.1).
const unauthorized = (
  request: HttpServerRequest.HttpServerRequest,
  error?: "invalid_token"
) => {
  const params = [
    ...(error === undefined ? [] : [`error="${error}"`]),
    `resource_metadata="${originOf(request)}${PROTECTED_RESOURCE_PATH}"`,
  ];

  return HttpServerResponse.empty({
    headers: { "www-authenticate": `Bearer ${params.join(", ")}` },
    status: 401,
  });
};

const Caller = Context.Reference<
  Option.Option<{ readonly person: Person; readonly token: string }>
>("platform/Caller", { defaultValue: Option.none });

const identifyCaller = HttpRouter.middleware(
  Effect.gen(function* () {
    const sessions = yield* Sessions;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        const [path = request.url] = request.url.split("?");

        const { authorization } = request.headers;

        if (authorization === undefined || isExempt(path)) {
          return yield* httpEffect;
        }

        const token = bearerToken(authorization);

        if (Option.isNone(token)) {
          return unauthorized(request);
        }

        const person = yield* sessions.verify(token.value);

        if (Option.isNone(person)) {
          return unauthorized(request, "invalid_token");
        }

        return yield* Effect.provideService(
          httpEffect,
          Caller,
          Option.some({ person: person.value, token: token.value })
        );
      });
  }),
  { global: true }
);

const signedInOnly = HttpRouter.middleware((httpEffect) =>
  Effect.gen(function* () {
    if (Option.isSome(yield* Caller)) {
      return yield* httpEffect;
    }

    return unauthorized(yield* HttpServerRequest.HttpServerRequest);
  })
).layer;

// A call naming a credential other than the one its request was let in with (one an
// RPC message adds to its own headers) runs as nobody.
const asCaller = authenticated((credential) =>
  Caller.useSync(
    Option.flatMap(({ person, token }) =>
      token === credential ? Option.some(person) : Option.none()
    )
  )
);

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

// Made from the skill's parts, not its `SKILL.md`, whose hash is a promise the
// router's build may not await.
const contribute = skillPrompt(
  platformSkillParts({ commands: commandDocs(Contracts) })
);

const mcp = Layer.mergeAll(
  McpServer.toolkit(projection.toolkit).pipe(
    Layer.provideMerge(projection.layer)
  ),
  briefResources,
  contribute
).pipe(
  Layer.provide(Layer.effect(Client, RpcTest.makeClient(Contracts))),
  Layer.provide([asCaller, forwardCredential]),
  Layer.provide(
    McpServer.layerHttp({
      name: Brand.name,
      path: "/mcp",
      protocols: [McpProtocol.v2026_07_28],
      version: "0.0.0",
    }).pipe(Layer.provide(signedInOnly))
  )
);

const rpcIn = (serialization: Layer.Layer<RpcSerialization.RpcSerialization>) =>
  RpcServer.toHttpEffect(Contracts).pipe(Effect.provide(serialization));

const rpc = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const whole = yield* rpcIn(RpcSerialization.layerJson);
    const framed = yield* rpcIn(RpcSerialization.layerNdjson);

    yield* router.add("POST", "/rpc", (request) =>
      isFramed(request.headers) ? framed : whole
    );
  })
).pipe(Layer.provide(asCaller));

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

const fromWeb =
  <R>(respond: (web: Request) => Effect.Effect<Response, never, R>) =>
  (request: HttpServerRequest.HttpServerRequest) =>
    HttpServerRequest.toWeb(request).pipe(
      Effect.flatMap(respond),
      Effect.map(HttpServerResponse.fromWeb),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 400 }))
    );

const home = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(FrontPage, yield* FrontPage).pipe(
      Context.add(HostInfo, yield* HostInfo),
      Context.add(Projects, yield* Projects),
      Context.add(StandingPostures, yield* StandingPostures)
    );

    yield* router.add(
      "GET",
      "/",
      fromWeb((web) => Effect.provide(homeResponse(web), services))
    );
  })
);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const ADDRESSES = ["/:a", "/:a/:b", "/:a/:b/:c"] as const;

const addressOf = (params: Readonly<Record<string, string | undefined>>) =>
  [params.a, params.b, params.c]
    .filter((segment) => segment !== undefined)
    .join("/");

const RAW_ROUTES = ADDRESSES.map((address) => `${address}/raw/*` as const);

const GIT_ROUTES = ADDRESSES.flatMap((address) => [
  `${address}/info/refs` as const,
  `${address}/git-upload-pack` as const,
  `${address}/git-receive-pack` as const,
]);

const raw = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(RepoHost, yield* RepoHost).pipe(
      Context.add(Projects, yield* Projects),
      Context.add(CodeCache, yield* CodeCache),
      Context.add(CodeStore, yield* CodeStore)
    );

    for (const path of RAW_ROUTES) {
      yield* router.add("GET", path, (request) =>
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;

          return yield* Option.match(decodeProject(addressOf(params)), {
            onNone: () =>
              Effect.succeed(HttpServerResponse.empty({ status: 404 })),
            onSome: (project) =>
              fromWeb((web) =>
                Effect.provide(rawResponse(web, project), services)
              )(request),
          });
        })
      );
    }
  })
);

const discovery = HttpRouter.use((router) =>
  router.add("GET", PROTECTED_RESOURCE_PATH, (request) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        protectedResourceMetadata(originOf(request))
      )
    )
  )
);

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

const git = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(Sessions, yield* Sessions).pipe(
      Context.add(Projects, yield* Projects),
      Context.add(Upstream, yield* Upstream),
      Context.add(LayerGate, yield* LayerGate)
    );

    for (const path of GIT_ROUTES) {
      yield* router.add("*", path, (request) =>
        Effect.provide(toGateway(request), services)
      );
    }
  })
);

export const serve = <E>(services: Layer.Layer<Services, E>) =>
  buildHandler(
    Layer.mergeAll(
      home,
      health,
      discovery,
      raw,
      git,
      mcp,
      rpc,
      releaseRoutes,
      agentSkillRoutes,
      identifyCaller
    ).pipe(Layer.provide(services))
  );
