// Ported from joelhooks/rat-stack@fba26d8 `packages/capability/src/to-toolkit.ts`
// l.18–146, and ours to change since: it projects the contracts' Rpcs, with
// hints from our own annotations, not Rat Stack's capabilities. Rat Stack's
// licence travels with the code it copied:
//
// MIT License
//
// Copyright (c) 2026 Joel Hooks
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type { JsonSchema, Layer } from "effect";
import { Context, Effect, JsonPointer, Predicate, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import type { Rpc, RpcClient, RpcClientError, RpcGroup } from "effect/rpc";

import {
  Description,
  Destructive,
  Idempotent,
  NeedsApproval,
  ReadOnly,
} from "./annotations.ts";
import type { Unauthenticated } from "./principal.ts";

type CallError = RpcClientError.RpcClientError | Unauthenticated;

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

export interface ToolListing {
  readonly name: string;
  readonly description: string;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly idempotentHint: boolean;
    readonly destructiveHint: boolean;
    readonly openWorldHint: boolean;
  };
  readonly inputSchema: JsonSchema.JsonSchema;
  readonly outputSchema: JsonSchema.JsonSchema;
}

/**
 * The definition a `$ref` names, read as Effect reads it: a URI fragment
 * (percent-encoded, then `~1` and `~0` escaped) of the form `#/$defs/<key>`.
 */
const definitionKey = ($ref: string) => {
  const tokens = JsonPointer.parseUriFragment($ref);

  return tokens?.length === 2 && tokens[0] === "$defs" ? tokens[1] : undefined;
};

/** Derived the way `McpServer` derives a tool's: a top-level `$ref` is inlined. */
export const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const { definitions, schema: root } = Schema.toJsonSchemaDocument(schema);

  const key = Predicate.isString(root.$ref)
    ? definitionKey(root.$ref)
    : undefined;

  const inlined = (key === undefined ? undefined : definitions[key]) ?? root;

  return Object.keys(definitions).length === 0
    ? inlined
    : { ...inlined, $defs: definitions };
};

export const listTools = <Tools extends Readonly<Record<string, Tool.Any>>>(
  toolkit: Toolkit.Toolkit<Tools>
): readonly ToolListing[] =>
  Object.entries(toolkit.tools).map(([name, tool]) => ({
    annotations: {
      destructiveHint: Context.get(tool.annotations, Tool.Destructive),
      idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
      openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
    },
    description: Tool.getDescription(tool) ?? "",
    inputSchema: toJsonSchema(tool.parametersSchema),
    name,
    outputSchema: toJsonSchema(tool.successSchema),
  }));

export interface ToolkitProjection<Rpcs extends Rpc.AnyWithProps, R> {
  readonly toolkit: Toolkit.Toolkit<ToolsOf<Rpcs>>;
  readonly layer: Layer.Layer<Tool.HandlersFor<ToolsOf<Rpcs>>, never, R>;
}

const ASKS_FIRST = " Asks a person first.";

// Every hint is explicit: MCP's defaults read an unannotated tool as
// destructive and open-world.
const toTool = (rpc: Rpc.AnyWithProps) => {
  const description = Context.get(rpc.annotations, Description);

  return Tool.make(rpc._tag, {
    description: Context.get(rpc.annotations, NeedsApproval)
      ? `${description}${ASKS_FIRST}`
      : description,
    failure: rpc.errorSchema,
    parameters: rpc.payloadSchema,
    success: rpc.successSchema,
  })
    .annotate(Tool.Readonly, Context.get(rpc.annotations, ReadOnly))
    .annotate(Tool.Idempotent, Context.get(rpc.annotations, Idempotent))
    .annotate(Tool.Destructive, Context.get(rpc.annotations, Destructive))
    .annotate(Tool.OpenWorld, false);
};

export const toToolkit = <Rpcs extends Rpc.AnyWithProps, R>(
  group: RpcGroup.RpcGroup<Rpcs>,
  client: Effect.Effect<RpcClient.RpcClient<Rpcs, CallError>, never, R>
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
          ) => Effect.Effect<Rpc.Success<Rpcs>, Rpc.Error<Rpcs> | CallError>
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
