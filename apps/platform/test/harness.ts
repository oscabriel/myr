import { Contracts } from "@repo/protocol/contracts";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { serve } from "../src/surfaces.ts";
import type { Services } from "../src/surfaces.ts";

const origin = "http://localhost";

// MCP's 2026-07-28 protocol is stateless: each request names its version and
// client in `_meta` and repeats its method and target in headers.
const version = "2026-07-28";

const meta = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
  "io.modelcontextprotocol/protocolVersion": version,
};

/** A tools/call over MCP's HTTP transport, as `token`'s bearer if given. */
export const toolCall = (
  name: string,
  args: Readonly<Record<string, string>>,
  token?: string
) => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-method": "tools/call",
    "mcp-name": name,
    "mcp-protocol-version": version,
  });

  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return new Request(`${origin}/mcp`, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { _meta: meta, arguments: args, name },
    }),
    headers,
    method: "POST",
  });
};

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

/** A tool call's outcome: whether it failed, and its JSON. */
export const toolResult = (response: Response) =>
  lastMessage(response).pipe(
    Effect.flatMap(Schema.decodeEffect(Reply)),
    Effect.map(({ result }) => ({
      isError: result.isError,
      json: result.content[0].text,
    }))
  );

/**
 * The platform's fetch handler over `services`, disposed with the scope: as
 * an Effect, and as the plain function a fetch client calls.
 */
export const served = Effect.fnUntraced(function* (
  services: Layer.Layer<Services>
) {
  const { dispose, handler } = serve(services);

  yield* Effect.addFinalizer(() => Effect.promise(dispose));

  return {
    fetch: (request: Request) => Effect.promise(() => handler(request)),
    handler,
  };
});

/**
 * A client of the contracts over HTTP at `/rpc`, as the CLI makes one: its
 * requests go to `handler`, each with `token` as its HTTP bearer, which the
 * RPC server reads into every call's headers.
 */
export const rpcClient = (
  handler: (request: Request) => Promise<Response>,
  token: string
) => {
  const fetch: typeof globalThis.fetch = (input, init) =>
    handler(new Request(input, init));

  return RpcClient.make(Contracts).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({
        transformClient: HttpClient.mapRequest(
          HttpClientRequest.bearerToken(token)
        ),
        url: `${origin}/rpc`,
      }).pipe(
        Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
      )
    )
  );
};
