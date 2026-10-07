import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";

import { Description } from "../src/annotations.ts";
import { Contracts, ListAsks, SubmitAnswer } from "../src/contracts.ts";
import { AskId, CommitSha } from "../src/ids.ts";
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
