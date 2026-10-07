import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { HttpRouter } from "effect/http";
import type { Rpc, RpcGroup } from "effect/rpc";
import { RpcTest } from "effect/rpc";

import { Client, Contracts } from "../src/contracts.ts";
import { toToolkit } from "../src/mcp.ts";
import { asTester } from "../src/testing.ts";

const endpoint = "http://localhost/mcp";

const protocol = McpProtocol.v2026_07_28;

// The 2026-07-28 protocol is stateless: each request names its version and
// client in `_meta` and repeats its method and target in headers.
const meta = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
  "io.modelcontextprotocol/protocolVersion": protocol.protocolVersion,
};

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

const Reply = Schema.fromJsonString(Schema.Struct({ result: Schema.Unknown }));

/** What a request carries: a tool call names its tool and its arguments. */
interface Params {
  readonly arguments?: Readonly<Record<string, string>>;
  readonly name?: string;
}

/**
 * Serves the contracts' tools over MCP's HTTP transport, the way a Worker's
 * fetch handler would, with `handlers` answering each call.
 */
export const serve = Effect.fnUntraced(function* (
  handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>>
) {
  const projection = toToolkit(Contracts, Effect.service(Client));

  const app = McpServer.toolkit(projection.toolkit).pipe(
    Layer.provideMerge(projection.layer),
    Layer.provide(Layer.effect(Client)(RpcTest.makeClient(Contracts))),
    Layer.provide([handlers, asTester]),
    Layer.provide(
      McpServer.layerHttp({
        name: "test",
        path: "/mcp",
        protocols: [protocol],
        version: "0.0.0",
      })
    )
  );

  const { dispose, handler } = HttpRouter.toWebHandler(app, {
    disableLogger: true,
  });

  yield* Effect.addFinalizer(() => Effect.promise(dispose));

  /** Sends one request and decodes its result with `result`. */
  const call = Effect.fnUntraced(function* <A>(
    method: string,
    params: Params,
    result: Schema.Decoder<A>
  ) {
    const headers = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": protocol.protocolVersion,
    });

    if (params.name !== undefined) {
      headers.set("mcp-name", params.name);
    }

    const response = yield* Effect.promise(() =>
      handler(
        new Request(endpoint, {
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method,
            params: { ...params, _meta: meta },
          }),
          headers,
          method: "POST",
        })
      )
    );

    const reply = yield* Schema.decodeEffect(Reply)(
      yield* lastMessage(response)
    );

    return yield* Schema.decodeUnknownEffect(result)(reply.result);
  });

  return { call };
});
