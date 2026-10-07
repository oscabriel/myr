import { NodeServices } from "@effect/platform-node";
import { Client, Contracts } from "@repo/protocol/contracts";
import { asTester } from "@repo/protocol/testing";
import {
  Effect,
  Fiber,
  Layer,
  Predicate,
  Queue,
  Schema,
  Sink,
  Stdio,
  Stream,
} from "effect";
import type { Cause } from "effect";
import { CliOutput, Command } from "effect/cli";
import type { Rpc, RpcGroup } from "effect/rpc";
import { RpcTest } from "effect/rpc";

import { mcp } from "../src/surfaces.ts";

const Message = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Int])),
    result: Schema.optionalKey(Schema.Unknown),
  })
);

/**
 * Runs `mcp` as a harness would spawn it: `messages` go in on stdin, one JSON
 * line each, then stdin ends. Returns every result it wrote back, by id.
 */
export const session = (
  handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof Contracts>>>,
  messages: readonly object[]
) =>
  Effect.gen(function* () {
    const written = yield* Queue.unbounded<string | Uint8Array, Cause.Done>();
    const encoder = new TextEncoder();

    const stdio = Stdio.layerTest({
      stdin: Stream.fromIterable(
        messages.map((message) =>
          encoder.encode(`${JSON.stringify(message)}\n`)
        )
      ),
      stdout: () => Sink.fromQueue(written),
    });

    // The stdio server interrupts the fiber that started it once stdin ends,
    // as a process would exit, so it runs in a fiber of its own. The test
    // stdio comes last, so it stands in for the real one.
    const server = yield* Command.runWith(mcp, { version: "0.0.0" })([]).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
          Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
            Layer.provide([handlers, asTester])
          ),
          stdio
        )
      ),
      Effect.forkChild
    );

    yield* Fiber.await(server);

    const decoder = new TextDecoder();

    const text = (yield* Queue.clear(written))
      .map((chunk) =>
        Predicate.isString(chunk) ? chunk : decoder.decode(chunk)
      )
      .join("");

    const lines = text.split("\n").filter((line) => line.length > 0);

    const replies = yield* Effect.forEach(lines, (line) =>
      Schema.decodeEffect(Message)(line)
    );

    return new Map(replies.map((reply) => [reply.id, reply.result]));
  });
