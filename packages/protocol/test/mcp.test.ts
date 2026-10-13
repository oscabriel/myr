import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Tool } from "effect/ai";
import { Rpc, RpcGroup } from "effect/rpc";

import { Description, NeedsApproval } from "../src/annotations.ts";
import {
  Client,
  Contracts,
  ListAsks,
  SubmitAnswer,
  surfaced,
} from "../src/contracts.ts";
import { PROJECT_DESCRIPTION_CAP } from "../src/domain/front-page.ts";
import { AskId, CommitSha, KindName, ProjectName } from "../src/ids.ts";
import { listTools, toJsonSchema, toToolkit } from "../src/mcp.ts";
import { StaleBase } from "../src/refusal.ts";
import { unanswered } from "../src/testing.ts";
import { ask, base, main, path } from "./examples.ts";
import { leaks, nested } from "./leaks.ts";
import { serve } from "./mcp.ts";

const head = CommitSha.make("3333333333333333333333333333333333333333");

const project = ProjectName.make("oscabriel/datekit");

const answer = { ask, base, head, project, requestId: "answer-0001" };

const ToolResult = Schema.Struct({
  content: Schema.Tuple([
    Schema.Struct({
      text: Schema.fromJsonString(Schema.Unknown),
      type: Schema.Literal("text"),
    }),
  ]),
  isError: Schema.Boolean,
});

const stale = (refusal: StaleBase) =>
  Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("submitAnswer", () => Effect.fail(refusal))
  );

const ToolList = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      description: Schema.String,
      inputSchema: Schema.Struct({
        required: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
      name: Schema.String,
    })
  ),
});

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

const ProjectDescriptionSchema = Schema.Struct({
  maxLength: Schema.Int,
  type: Schema.Literal("string"),
});

const LandingsSchema = Schema.Struct({
  minimum: Schema.Int,
  type: Schema.Literal("integer"),
});

/** A project's listing in a JSON Schema, its description's and landings' schemas beside what it requires. */
const ListingSchema = Schema.Struct({
  properties: Schema.Struct({
    description: ProjectDescriptionSchema,
    landings: LandingsSchema,
  }),
  required: Schema.Array(Schema.String),
});

const decodeListingSchema = Schema.decodeUnknownOption(ListingSchema);

const receipt = {
  additionalProperties: true,
  properties: { main: { pattern: "^[0-9a-f]{40}$", type: "string" } },
  required: ["main"],
  type: "object",
};

describe("the contracts as MCP tools", () => {
  it.effect(
    "lists each MCP-surfaced contract as a tool, its payload as the input",
    () =>
      Effect.gen(function* () {
        const mcp = yield* serve(unanswered);

        const { tools } = yield* mcp.call("tools/list", {}, ToolList);

        const byName = new Map(tools.map((tool) => [tool.name, tool]));

        expect(tools.map(({ name }) => name)).toStrictEqual([
          ...surfaced("mcp").requests.keys(),
        ]);
        expect(byName.get("listAsks")).toStrictEqual({
          description: Context.get(ListAsks.annotations, Description),
          inputSchema: { required: ["project"] },
          name: "listAsks",
        });
        expect(byName.get("submitAnswer")).toStrictEqual({
          description: Context.get(SubmitAnswer.annotations, Description),
          inputSchema: {
            required: ["ask", "base", "head", "project", "requestId"],
          },
          name: "submitAnswer",
        });
      })
  );

  it.effect(
    "offers no tool for watching a project, setting a value or reading a log",
    () =>
      Effect.gen(function* () {
        const mcp = yield* serve(unanswered);

        const { tools } = yield* mcp.call("tools/list", {}, ToolList);

        const names = tools.map(({ name }) => name);

        expect(names).toContain("listProjects");
        expect(names).not.toContain("watch");
        expect(names).not.toContain("setEnv");
        expect(names).not.toContain("evidence");
      })
  );

  it.effect(
    "hints that listing asks only reads, and that an answer can be offered again",
    () =>
      Effect.gen(function* () {
        const mcp = yield* serve(unanswered);

        const { tools } = yield* mcp.call("tools/list", {}, HintedTools);

        expect(
          tools.filter(({ name }) =>
            ["listAsks", "submitAnswer"].includes(name)
          )
        ).toStrictEqual([
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

  it.effect(
    "offers the capped code reads as tools that only read, and neither a commit's diff nor every path",
    () =>
      Effect.gen(function* () {
        const mcp = yield* serve(unanswered);

        const { tools } = yield* mcp.call("tools/list", {}, HintedTools);

        const names = tools.map(({ name }) => name);

        expect(
          tools
            .filter(({ name }) =>
              ["listRefs", "log", "readFile", "readTree", "why"].includes(name)
            )
            .map(({ annotations, name }) => ({
              idempotentHint: annotations.idempotentHint,
              name,
              readOnlyHint: annotations.readOnlyHint,
            }))
        ).toStrictEqual(
          ["listRefs", "readTree", "readFile", "log", "why"].map((name) => ({
            idempotentHint: true,
            name,
            readOnlyHint: true,
          }))
        );
        expect(names).not.toContain("showCommit");
        expect(names).not.toContain("listPaths");
      })
  );

  it.effect("lists each tool exactly as listTools describes it", () =>
    Effect.gen(function* () {
      const mcp = yield* serve(unanswered);

      const { tools } = yield* mcp.call("tools/list", {}, ListedTools);

      expect(tools).toStrictEqual(
        listTools(toToolkit(surfaced("mcp"), Effect.service(Client)).toolkit)
      );
    })
  );

  it("finds both of Effect's known JSON Schema leaks", () => {
    const leaky = Schema.toJsonSchemaDocument(
      Schema.Struct({
        count: Schema.Number,
        note: Schema.optional(Schema.String),
      })
    );

    expect(
      leaks(Schema.decodeUnknownSync(Schema.Json)(leaky.schema))
    ).toStrictEqual([
      "null under optional key note",
      "non-finite string Infinity",
      "non-finite string -Infinity",
      "non-finite string NaN",
    ]);
  });

  it("gives every tool an input and an output schema, with no leak in either", () => {
    const tools = listTools(
      toToolkit(surfaced("mcp"), Effect.service(Client)).toolkit
    );

    const schemas = tools.flatMap(({ inputSchema, outputSchema }) =>
      [inputSchema, outputSchema].map((schema) =>
        Schema.decodeUnknownSync(Schema.Json)(schema)
      )
    );

    expect(tools.length).toBeGreaterThan(20);
    expect(schemas).toHaveLength(2 * tools.length);
    expect(schemas.flatMap(leaks)).toStrictEqual([]);
  });

  it("lists each project with an optional description, capped in length, and an optional count of landings", () => {
    const listProjects = listTools(
      toToolkit(surfaced("mcp"), Effect.service(Client)).toolkit
    ).find(({ name }) => name === "listProjects");

    const listings = nested(
      Schema.decodeUnknownSync(Schema.Json)(listProjects?.outputSchema)
    ).flatMap((node) => Option.toArray(decodeListingSchema(node)));

    expect(
      listings.map(({ properties }) => properties.description)
    ).toStrictEqual([{ maxLength: PROJECT_DESCRIPTION_CAP, type: "string" }]);
    expect(listings.map(({ properties }) => properties.landings)).toStrictEqual(
      [{ minimum: 0, type: "integer" }]
    );
    expect(listings.flatMap(({ required }) => required)).not.toContain(
      "description"
    );
    expect(listings.flatMap(({ required }) => required)).not.toContain(
      "landings"
    );
  });

  it("inlines a named root schema, since MCP wants an object at the root", () => {
    expect(
      toJsonSchema(
        Schema.Struct({ main: CommitSha }).annotate({ identifier: "Receipt" })
      )
    ).toStrictEqual({ ...receipt, $defs: { Receipt: receipt } });
  });

  // The pointer to "Answer receipt" is `#/$defs/Answer%20receipt`.
  it("inlines a named root whose pointer is percent-encoded", () => {
    expect(
      toJsonSchema(
        Schema.Struct({ main: CommitSha }).annotate({
          identifier: "Answer receipt",
        })
      )
    ).toStrictEqual({ ...receipt, $defs: { "Answer receipt": receipt } });
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

      const mcp = yield* serve(stale(refusal));

      const result = yield* mcp.call(
        "tools/call",
        { arguments: answer, name: "submitAnswer" },
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
        Layer.mergeAll(
          unanswered,
          Contracts.toLayerHandler("listAsks", () =>
            Effect.succeed({
              asks: [
                {
                  ask: AskId.make("fix-parser"),
                  blockedBy: [],
                  claimed: false,
                  kind: KindName.make("fix"),
                  territory: "packages/parser",
                  want: "Parse a trailing comma",
                },
              ],
            })
          )
        )
      );

      const result = yield* mcp.call(
        "tools/call",
        { arguments: { project: "oscabriel/demo" }, name: "listAsks" },
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
              blockedBy: [],
              claimed: false,
              kind: "fix",
              territory: "packages/parser",
              want: "Parse a trailing comma",
            },
          ],
        },
      });
    })
  );
});
