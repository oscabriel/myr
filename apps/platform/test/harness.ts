import { RepoHost } from "@repo/artifacts/repo-host";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { Upstream } from "@repo/git/upstream";
import type { FrontPage } from "@repo/project/front-page";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { Projects } from "@repo/project/projects";
import { Contracts } from "@repo/protocol/contracts";
import { UnknownProject } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { MemoryRateLimits, WorkerCaps } from "../src/adapters/rate-limits.ts";
import { Handlers } from "../src/handlers.ts";
import { ReleaseStore } from "../src/releases.ts";
import { HostInfo, serve, Stage } from "../src/surfaces.ts";
import type { Services } from "../src/surfaces.ts";

/** Where every test request goes: the platform as `served` answers it. */
export const origin = "http://localhost";

// MCP's 2026-07-28 protocol is stateless: each request names its version and
// client in `_meta` and repeats its method and target in headers.
const version = "2026-07-28";

const meta = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
  "io.modelcontextprotocol/protocolVersion": version,
};

/** What an MCP request carries: a tool call names its tool and its arguments. */
interface Params {
  readonly arguments?: Readonly<Record<string, string>>;
  readonly name?: string;
}

/** One MCP request over the HTTP transport, as `token`'s bearer if given. */
const mcpRequest = (method: string, params: Params, token?: string) => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-method": method,
    "mcp-protocol-version": version,
  });

  if (params.name !== undefined) {
    headers.set("mcp-name", params.name);
  }

  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return new Request(`${origin}/mcp`, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params: { _meta: meta, ...params },
    }),
    headers,
    method: "POST",
  });
};

/** A tools/call over MCP's HTTP transport, as `token`'s bearer if given. */
export const toolCall = (
  name: string,
  args: Readonly<Record<string, string>>,
  token?: string
) => mcpRequest("tools/call", { arguments: args, name }, token);

/** A tools/list over MCP's HTTP transport, as `token`'s bearer. */
export const toolList = (token: string) => mcpRequest("tools/list", {}, token);

/** A tools/call result whose one content block is JSON text. */
const ToolResult = Schema.Struct({
  content: Schema.Tuple([
    Schema.Struct({
      text: Schema.fromJsonString(Schema.Unknown),
      type: Schema.Literal("text"),
    }),
  ]),
  isError: Schema.Boolean,
});

const Reply = Schema.fromJsonString(Schema.Struct({ result: ToolResult }));

/** The last JSON-RPC message in a reply, which is plain JSON or an event stream. */
const lastMessage = (response: Response) =>
  Effect.promise(() => response.text()).pipe(
    Effect.map((text) =>
      response.headers.get("content-type")?.includes("text/event-stream") ===
      true
        ? (text
            .split("\n")
            .findLast((line) => line.startsWith("data: "))
            ?.slice("data: ".length) ?? "")
        : text
    )
  );

const Listed = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      tools: Schema.Array(Schema.Struct({ name: Schema.String })),
    }),
  })
);

/** The names of the tools a tools/list reply lists, in its order. */
export const toolNames = (response: Response) =>
  lastMessage(response).pipe(
    Effect.flatMap(Schema.decodeEffect(Listed)),
    Effect.map(({ result }) => result.tools.map(({ name }) => name))
  );

/** A tool call's outcome: whether it failed, and its JSON. */
export const toolResult = (response: Response) =>
  lastMessage(response).pipe(
    Effect.flatMap(Schema.decodeEffect(Reply)),
    Effect.map(({ result }) => ({
      isError: result.isError,
      json: result.content[0].text,
    }))
  );

/** A port method a surfaces test never calls: a call is the test's defect. */
const unused = (port: string) => () =>
  Effect.die(`a surfaces test called ${port}, which it never sets up`);

/**
 * What a surfaces test may leave out: git's ports and the release store,
 * unused (no test here pushes, and only the releases test downloads), a
 * front page that lists no project and the repos behind it, unused (so the
 * skills index is empty), the stage, `local`, and a host with no web app
 * whose drafter is `test-model`.
 */
const defaults = Layer.mergeAll(
  Layer.succeed(
    Projects,
    Projects.of({ create: unused("Projects"), get: unused("Projects") })
  ),
  Layer.succeed(Upstream, Upstream.of({ exchange: unused("Upstream") })),
  Layer.succeed(ReleaseStore, ReleaseStore.of({ get: unused("ReleaseStore") })),
  FrontPageMemory.layer({ credits: [], entries: [], projects: [] }),
  Layer.succeed(RepoHost, untouchable<RepoHost["Service"]>("RepoHost")),
  Layer.succeed(Stage, Stage.of({ name: "local" })),
  Layer.succeed(
    HostInfo,
    HostInfo.of({ draftModel: "test-model", webUrl: Option.none() })
  )
);

/**
 * The contracts before any project exists, served by the platform's own
 * handlers: a call that names a project finds none (`UnknownProject`), the
 * front page lists nothing, nobody is near a rate limit, no lane has
 * left a log, and no repo is read.
 */
export const noProjects = Handlers.pipe(
  Layer.provide([
    Layer.succeed(
      Projects,
      Projects.of({
        create: unused("Projects.create"),
        get: (project) => Effect.fail(new UnknownProject({ project })),
      })
    ),
    FrontPageMemory.layer({ credits: [], entries: [], projects: [] }),
    MemoryRateLimits(WorkerCaps),
    EvidenceStoreMemory,
    Layer.succeed(RepoHost, untouchable<RepoHost["Service"]>("RepoHost")),
  ])
);

/**
 * The platform's fetch handler over `services`, disposed with the scope: as
 * an Effect, and as the plain function a fetch client calls.
 */
export const served = Effect.fnUntraced(function* <E>(
  services: Layer.Layer<
    Exclude<
      Services,
      | Projects
      | ReleaseStore
      | Upstream
      | FrontPage
      | RepoHost
      | Stage
      | HostInfo
    >,
    E
  >
) {
  const { dispose, handler } = serve(Layer.merge(defaults, services));

  yield* Effect.addFinalizer(() => Effect.promise(dispose));

  return {
    fetch: (request: Request) => Effect.promise(() => handler(request)),
    handler,
  };
});

/**
 * A client of the contracts over HTTP at `/rpc`, as the CLI makes one: its
 * requests go to `handler`, each with `token` as its HTTP bearer, which the
 * RPC server reads into every call's headers. Without a token it calls as
 * anyone, as the web does before sign-in.
 */
export const rpcClient = (
  handler: (request: Request) => Promise<Response>,
  token?: string
) => {
  const fetch: typeof globalThis.fetch = (input, init) =>
    handler(new Request(input, init));

  return RpcClient.make(Contracts).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({
        transformClient: HttpClient.mapRequest((request) =>
          token === undefined
            ? request
            : HttpClientRequest.bearerToken(request, token)
        ),
        url: `${origin}/rpc`,
      }).pipe(
        Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
      )
    )
  );
};
