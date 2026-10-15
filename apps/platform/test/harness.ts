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

export const origin = "http://localhost";

// MCP's 2026-07-28 protocol is stateless: each request names its version and
// client in `_meta` and repeats its method and target in headers.
const version = "2026-07-28";

const meta = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
  "io.modelcontextprotocol/protocolVersion": version,
};

interface Params {
  readonly arguments?: Readonly<Record<string, string>>;
  readonly name?: string;
}

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

export const toolCall = (
  name: string,
  args: Readonly<Record<string, string>>,
  token?: string
) => mcpRequest("tools/call", { arguments: args, name }, token);

export const toolList = (token: string) => mcpRequest("tools/list", {}, token);

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

export const toolNames = (response: Response) =>
  lastMessage(response).pipe(
    Effect.flatMap(Schema.decodeEffect(Listed)),
    Effect.map(({ result }) => result.tools.map(({ name }) => name))
  );

export const toolResult = (response: Response) =>
  lastMessage(response).pipe(
    Effect.flatMap(Schema.decodeEffect(Reply)),
    Effect.map(({ result }) => ({
      isError: result.isError,
      json: result.content[0].text,
    }))
  );

const unused = (port: string) => () =>
  Effect.die(`a surfaces test called ${port}, which it never sets up`);

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
  Layer.succeed(HostInfo, HostInfo.of({ webUrl: Option.none() }))
);

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
