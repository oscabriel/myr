import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { Rpc, RpcGroup } from "effect/rpc";

import { Description, NeedsApproval } from "../src/annotations.ts";
import { Client, Contracts, ListAsks, SubmitAnswer } from "../src/contracts.ts";
import { AskId, CommitSha, ProjectName } from "../src/ids.ts";
import { listTools, toJsonSchema, toToolkit } from "../src/mcp.ts";
import { StaleBase } from "../src/refusal.ts";
import { ask, base, main, path } from "./examples.ts";
import { serve } from "./mcp.ts";

const head = CommitSha.make("3333333333333333333333333333333333333333");

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

/** Handlers that never refuse, for tests about the tools themselves. */
const quiet = Contracts.toLayer({
  listAsks: () => Effect.succeed({ asks: [] }),
  submitAnswer: () => Effect.succeed({ main }),
});

const ToolList = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      description: Schema.String,
      inputSchema: Schema.Struct({ required: Schema.Array(Schema.String) }),
      name: Schema.String,
    })
  ),
});

/** The hints a harness reads before it calls a tool. */
const HintedTools = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      annotations: Schema.Struct({
        destructiveHint: Schema.Boolean,
        idempotentHint: Schema.Boolean,
        openWorldHint: Schema.Boolean,
        readOnlyHint: Schema.Boolean,
      }),
      name: Schema.String,
    })
  ),
});

/** Each tool as a client reads it, with its schemas left as JSON. */
const ListedTools = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      annotations: Schema.Unknown,
      description: Schema.String,
      inputSchema: Schema.Unknown,
      name: Schema.String,
      outputSchema: Schema.Unknown,
    })
  ),
});

describe("the contracts as MCP tools", () => {
  it.effect("lists each contract as a tool, its payload as the input", () =>
    Effect.gen(function* () {
      const mcp = yield* serve(quiet);

      const { tools } = yield* mcp.call("tools/list", {}, ToolList);

      expect(
        tools.map(({ description, inputSchema, name }) => ({
          description,
          name,
          required: inputSchema.required,
        }))
      ).toStrictEqual([
        {
          description: Context.get(ListAsks.annotations, Description),
          name: "listAsks",
          required: ["project"],
        },
        {
          description: Context.get(SubmitAnswer.annotations, Description),
          name: "submitAnswer",
          required: ["ask", "base", "head"],
        },
      ]);
    })
  );

  it.effect(
    "hints that listing asks only reads, and that an answer can be offered again",
    () =>
      Effect.gen(function* () {
        const mcp = yield* serve(quiet);

        const { tools } = yield* mcp.call("tools/list", {}, HintedTools);

        expect(tools).toStrictEqual([
          {
            annotations: {
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
              readOnlyHint: true,
            },
            name: "listAsks",
          },
          {
            annotations: {
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
              readOnlyHint: false,
            },
            name: "submitAnswer",
          },
        ]);
      })
  );

  // The generated reference reads `listTools`, so it says what a client sees.
  it.effect("lists each tool exactly as the reference describes it", () =>
    Effect.gen(function* () {
      const mcp = yield* serve(quiet);

      const { tools } = yield* mcp.call("tools/list", {}, ListedTools);

      expect(tools).toStrictEqual(
        listTools(toToolkit(Contracts, Effect.service(Client)).toolkit)
      );
    })
  );

  it("inlines a named root schema, since MCP wants an object at the root", () => {
    const receipt = {
      additionalProperties: true,
      properties: { main: { pattern: "^[0-9a-f]{40}$", type: "string" } },
      required: ["main"],
      type: "object",
    };

    expect(
      toJsonSchema(
        Schema.Struct({ main: CommitSha }).annotate({ identifier: "Receipt" })
      )
    ).toStrictEqual({ ...receipt, $defs: { Receipt: receipt } });
  });

  it("tells the agent a person approves a contract that needs approval", () => {
    class Abandon extends Rpc.make("abandon", {
      payload: { project: ProjectName },
    })
      .annotate(Description, "Abandon a project.")
      .annotate(NeedsApproval, true) {}

    const { toolkit } = toToolkit(
      RpcGroup.make(Abandon),
      Effect.die("a listing calls no tool")
    );

    expect(Tool.getDescription(toolkit.tools.abandon)).toBe(
      "Abandon a project. Asks a person first."
    );
  });

  it.effect("returns a refusal as JSON that keeps its tag", () =>
    Effect.gen(function* () {
      const refusal = new StaleBase({ base, conflicts: [path], main });

      const mcp = yield* serve(
        Contracts.toLayer({
          listAsks: () => Effect.succeed({ asks: [] }),
          submitAnswer: () => Effect.fail(refusal),
        })
      );

      const result = yield* mcp.call(
        "tools/call",
        { arguments: { ask, base, head }, name: "submitAnswer" },
        ToolResult
      );

      const [{ text }] = result.content;

      expect(result.isError).toBeTruthy();
      expect(text).toHaveProperty("_tag", "StaleBase");
      expect(yield* Schema.decodeUnknownEffect(StaleBase)(text)).toStrictEqual(
        refusal
      );
    })
  );

  it.effect("returns a contract's success as structured content", () =>
    Effect.gen(function* () {
      const mcp = yield* serve(
        Contracts.toLayer({
          listAsks: () =>
            Effect.succeed({
              asks: [
                {
                  ask: AskId.make("fix-parser"),
                  claimed: false,
                  territory: "packages/parser",
                  want: "Parse a trailing comma",
                },
              ],
            }),
          submitAnswer: () => Effect.succeed({ main }),
        })
      );

      const result = yield* mcp.call(
        "tools/call",
        { arguments: { project: "demo" }, name: "listAsks" },
        Schema.Struct({
          isError: Schema.Boolean,
          structuredContent: Schema.Unknown,
        })
      );

      expect(result).toStrictEqual({
        isError: false,
        structuredContent: {
          asks: [
            {
              ask: "fix-parser",
              claimed: false,
              territory: "packages/parser",
              want: "Parse a trailing comma",
            },
          ],
        },
      });
    })
  );
});
