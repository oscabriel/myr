// Ported from joelhooks/rat-stack@fba26d8 `packages/capability/src/to-toolkit.ts`
// (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
import type { Layer } from "effect";
import { Context, Effect } from "effect";
import { Tool, Toolkit } from "effect/ai";
import type { Rpc, RpcClient, RpcClientError, RpcGroup } from "effect/rpc";

import { Description } from "./annotations.ts";

/** How a call can fail on its way to the handler and back. */
type TransportError = RpcClientError.RpcClientError;

/** The tool an Rpc becomes: its payload as parameters, its errors as failures. */
export type ToolOf<R extends Rpc.Any> =
  R extends Rpc.Rpc<
    infer Tag,
    infer Payload,
    infer Success,
    infer Error,
    infer _Middleware,
    infer _Requires
  >
    ? Tool.Tool<
        Tag,
        {
          readonly failure: Error;
          readonly failureMode: "error";
          readonly parameters: Payload;
          readonly success: Success;
        }
      >
    : never;

export type ToolsOf<Rpcs extends Rpc.Any> = {
  readonly [R in Rpcs as R["_tag"]]: ToolOf<R>;
};

export interface ToolkitProjection<Rpcs extends Rpc.AnyWithProps, R> {
  readonly toolkit: Toolkit.Toolkit<ToolsOf<Rpcs>>;
  /** Handlers that answer each tool by calling its Rpc through the client. */
  readonly layer: Layer.Layer<Tool.HandlersFor<ToolsOf<Rpcs>>, never, R>;
}

const toTool = (rpc: Rpc.AnyWithProps) =>
  Tool.make(rpc._tag, {
    description: Context.get(rpc.annotations, Description),
    failure: rpc.errorSchema,
    parameters: rpc.payloadSchema,
    success: rpc.successSchema,
  });

/**
 * Projects a group of contracts onto MCP tools. A tool call runs as a call to
 * its Rpc through `client`, so a refusal reaches the agent as the Rpc's own
 * encoded error, `_tag` and all.
 */
export const toToolkit = <Rpcs extends Rpc.AnyWithProps, R>(
  group: RpcGroup.RpcGroup<Rpcs>,
  client: Effect.Effect<RpcClient.RpcClient<Rpcs, TransportError>, never, R>
): ToolkitProjection<Rpcs, R> => {
  const rpcs = [...group.requests.values()];

  const made: unknown = Toolkit.make(...rpcs.map(toTool));
  // SAFETY: `Toolkit.make` is variadic over a tuple of tools; `ToolsOf<Rpcs>` recovers the tuple's type, which `map` over the runtime array cannot carry.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tuple type is out of `map`'s reach; see SAFETY.
  const toolkit = made as Toolkit.Toolkit<ToolsOf<Rpcs>>;

  const layer = toolkit.toLayer(
    Effect.map(client, (calls) => {
      // SAFETY: an RpcClient for a group without prefixes has one method per tag, and the toolkit decodes a tool's parameters with that Rpc's payload schema before calling it.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a loop over tags cannot name each Rpc's method; see SAFETY.
      const byTag = calls as Readonly<
        Record<
          string,
          (
            payload: Rpc.Payload<Rpcs>
          ) => Effect.Effect<
            Rpc.Success<Rpcs>,
            Rpc.Error<Rpcs> | TransportError
          >
        >
      >;

      // Each handler passes the payload alone: the toolkit's second argument
      // is its own context, which the client would read as call options.
      const handlers: unknown = Object.fromEntries(
        Object.entries(byTag).map(([tag, call]) => [
          tag,
          (payload: Rpc.Payload<Rpcs>) => call(payload),
        ])
      );

      // SAFETY: the record is keyed by the group's tags, which are exactly the toolkit's tool names, and each value calls that tag's Rpc.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `fromEntries` cannot carry the mapped type; see SAFETY.
      return handlers as Toolkit.HandlersFrom<ToolsOf<Rpcs>>;
    })
  );

  return { layer, toolkit };
};
