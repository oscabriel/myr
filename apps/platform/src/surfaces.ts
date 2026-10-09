import { commandDocs } from "@repo/agent-kit/command-doc";
import { platformSkillParts } from "@repo/agent-kit/platform";
import { RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { Upstream } from "@repo/git/upstream";
import { CodeStore } from "@repo/project/code-store";
import { CodeCache } from "@repo/project/code/cache";
import { FrontPage } from "@repo/project/front-page";
import { Projects } from "@repo/project/projects";
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

/** What `/` says of the host: the web app's URL and the drafter's model. */
export { HostInfo } from "./host-info.ts";

/** Which stage this Worker serves: `/health` says so. */
export class Stage extends Context.Service<Stage, { readonly name: string }>()(
  "platform/Stage"
) {}

/**
 * What the surfaces need from the platform: the contracts' handlers,
 * sessions, what git's paths need, the CLI's releases, the front page and
 * the repos the projects' skills and raw files are read from, the stage,
 * and what `/` says of the host.
 */
export type Services =
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>
  | Sessions
  | GitServices
  | ReleaseStore
  | FrontPage
  | RepoHost
  | Stage
  | HostInfo;

/** git's smart-HTTP paths: `/<repo>(.git)/info/refs` and the two services. */
const GIT_PATH =
  /^\/[A-Za-z0-9._-]+\/(?:info\/refs|git-upload-pack|git-receive-pack)$/u;

/**
 * Where an OAuth client learns how to get a credential: these two
 * documents, with the path-suffixed forms RFC 8414 and RFC 9728 allow.
 */
const DISCOVERY_PATH =
  /^\/\.well-known\/oauth-(?:protected-resource|authorization-server)(?:\/.*)?$/u;

/**
 * Sign-in's own endpoints: `/authorize`, `/signup`,
 * `/token` and `/oauth/*`.
 */
const SIGN_IN_PATH = /^\/(?:authorize|signup|token|oauth(?:\/.*)?)$/u;

/**
 * A project's raw files, `/<project>/raw/<rev>/<path…>`: no git path, whose
 * second segment is `info` or a git service, ever matches it.
 */
const RAW_PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/raw\/.+$/u;

/**
 * The CLI's install script and releases (`releases.ts`):
 * `/install.sh`, `/releases/manifest.json` and `/releases/:version/:asset`.
 */
const RELEASE_PATH =
  /^\/(?:install\.sh|releases\/(?:manifest\.json|[^/]+\/[^/]+))$/u;

/**
 * The projects' contribute skills and their index
 * (`well-known.ts`), public as every landed tree is.
 */
const SKILLS_PATH = /^\/\.well-known\/agent-skills\/.+$/u;

/**
 * Paths no credential is asked for and none is checked on, so none answers
 * 401: `/health`; git's, whose gateway decides who may read and push (and
 * answers an unknown credential with its own 401); the paths that tell a
 * client how to sign in, or sign it in, which may carry a stale token or an
 * OAuth client's own credential; the CLI's downloads, which anyone may
 * fetch, with whatever credential an installer happens to carry; the
 * projects' skills, which an agent fetches the same way; the host's own
 * page, `/`; and a project's raw files, which a README's images name.
 */
const isExempt = (path: string) =>
  path === "/" ||
  path === "/health" ||
  RAW_PATH.test(path) ||
  GIT_PATH.test(path) ||
  DISCOVERY_PATH.test(path) ||
  SIGN_IN_PATH.test(path) ||
  RELEASE_PATH.test(path) ||
  SKILLS_PATH.test(path);

/** Where the platform describes itself as an OAuth protected resource. */
const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

/** The platform's origin, as the request reached it. */
const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  URL.parse(request.originalUrl)?.origin ??
  Option.match(HttpServerRequest.toURL(request), {
    onNone: () => "http://localhost",
    onSome: ({ origin }) => origin,
  });

/**
 * The platform as an OAuth protected resource (RFC 9728): a bearer token
 * in the `Authorization` header, from the platform's own authorization
 * server.
 */
export const protectedResourceMetadata = (origin: string) => ({
  authorization_servers: [origin] as const,
  bearer_methods_supported: ["header"] as const,
  resource: origin,
});

/**
 * A 401 for `request`: it asks for a bearer token and names where to learn
 * how to get one (RFC 9728 §5.1, which MCP's authorization requires). Its
 * `error` is `invalid_token` only for a bearer token the platform does not
 * know; a request with no credential, or one of another scheme, gets no
 * error code (RFC 6750 §3.1).
 */
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

/**
 * The bearer credential the request was let in with, and the person it
 * names; none when it carried none, and on an exempt path. Set once per
 * request, before any surface sees it, and read by the contracts' server
 * side, so a token is verified once per request.
 */
const Caller = Context.Reference<
  Option.Option<{ readonly person: Person; readonly token: string }>
>("platform/Caller", { defaultValue: Option.none });

/**
 * Who is calling, decided once per request, before any surface sees it: a
 * credential the platform does not know is a 401 on every path but the
 * exempt ones; a known one becomes the request's `Caller`. A request with
 * no credential goes on as anyone: each contract decides whether anyone may
 * call it, and MCP asks for one (`signedInOnly`).
 */
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

/**
 * The routes it is given answer only a request let in with a credential;
 * any other gets a 401 naming where to learn how to sign in. On the route,
 * not on a path, so it holds however the router matched the path.
 */
const signedInOnly = HttpRouter.middleware((httpEffect) =>
  Effect.gen(function* () {
    if (Option.isSome(yield* Caller)) {
      return yield* httpEffect;
    }

    return unauthorized(yield* HttpServerRequest.HttpServerRequest);
  })
).layer;

/**
 * Server side: protocol's `Authenticated` rule (anyone only on a `public`
 * contract), over the `Caller` the request was let in with rather than a
 * second verification. A call that names a credential other than the one
 * its request was let in with, such as one an RPC message adds to its own
 * headers, runs as nobody.
 */
const asCaller = authenticated((credential) =>
  Caller.useSync(
    Option.flatMap(({ person, token }) =>
      token === credential ? Option.some(person) : Option.none()
    )
  )
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
 * The platform's skill as the prompt `contribute`, made when the server
 * starts from agent-kit's command list, the one the CLI's prompt and the
 * web's `llms.txt` read, so they say the same. Made from the skill's parts,
 * not its `SKILL.md`, whose hash is a promise the router's build may not
 * await (`router-build.ts`).
 */
const contribute = skillPrompt(
  platformSkillParts({ commands: commandDocs(Contracts) })
);

/**
 * The MCP-surfaced contracts as tools at `/mcp`, beside each ask's brief
 * and the projects as resources and the skill as a prompt, for a signed-in
 * caller only (harnesses using MCP have tokens), each call
 * made as that caller through one `Client`.
 */
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

/** The contracts' server over HTTP in one serialization, as one handler. */
const rpcIn = (serialization: Layer.Layer<RpcSerialization.RpcSerialization>) =>
  RpcServer.toHttpEffect(Contracts).pipe(Effect.provide(serialization));

/**
 * The contracts over HTTP at `/rpc`, for the CLI, the web and anything else
 * remote: a public read as anyone, every other contract as the caller. A
 * call posted as JSON is answered in one JSON body when it ends; one posted
 * as NDJSON is answered framed, each message as it is ready, so a stream
 * (`watch`) reaches its caller as it happens.
 */
const rpc = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const whole = yield* rpcIn(RpcSerialization.layerJson);
    const framed = yield* rpcIn(RpcSerialization.layerNdjson);

    yield* router.add("POST", "/rpc", (request) =>
      isFramed(request.headers) ? framed : whole
    );
  })
).pipe(Layer.provide(asCaller));

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

/** A route that answers with a web `Response` from `respond`, given the web request. */
const fromWeb =
  <R>(respond: (web: Request) => Effect.Effect<Response, never, R>) =>
  (request: HttpServerRequest.HttpServerRequest) =>
    HttpServerRequest.toWeb(request).pipe(
      Effect.flatMap(respond),
      Effect.map(HttpServerResponse.fromWeb),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 400 }))
    );

/** `/`: what this host serves, for a browser and for an agent (`home.ts`). */
const home = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(FrontPage, yield* FrontPage).pipe(
      Context.add(HostInfo, yield* HostInfo)
    );

    yield* router.add(
      "GET",
      "/",
      fromWeb((web) => Effect.provide(homeResponse(web), services))
    );
  })
);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/** `/<project>/raw/<rev>/<path…>`: a project's raw files (`raw.ts`). */
const raw = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // The isolate's code cache and the code store, as the `/rpc` code
    // reads have them: `Context.Reference`s, so without them every raw read
    // goes to Artifacts.
    const services = Context.make(RepoHost, yield* RepoHost).pipe(
      Context.add(Projects, yield* Projects),
      Context.add(CodeCache, yield* CodeCache),
      Context.add(CodeStore, yield* CodeStore)
    );

    yield* router.add("GET", "/:project/raw/*", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;

        return yield* Option.match(decodeProject(params.project), {
          onNone: () =>
            Effect.succeed(HttpServerResponse.empty({ status: 404 })),
          onSome: (project) =>
            fromWeb((web) =>
              Effect.provide(rawResponse(web, project), services)
            )(request),
        });
      })
    );
  })
);

/**
 * The protected-resource document (RFC 9728), answered to anyone: where a
 * client learns that the platform is its own authorization server. The
 * authorization server's document is the sign-in provider's, which answers
 * its path before the surfaces see it (`auth/provider.ts`).
 */
const discovery = HttpRouter.use((router) =>
  router.add("GET", PROTECTED_RESOURCE_PATH, (request) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        protectedResourceMetadata(originOf(request))
      )
    )
  )
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
 * needs, taken once when the router is built: the layer repos too, which
 * a cartridge may have plugged in over their default (`LayerGate`).
 */
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

/**
 * The platform's fetch handler over `services`, its router built now,
 * before any request, awaiting nothing (`router-build.ts`).
 */
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
