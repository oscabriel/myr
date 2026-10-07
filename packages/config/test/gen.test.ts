import { describe, expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema } from "effect";

import { CommandCatalog, generate, Refusal } from "../../../scripts/lib/gen.ts";

const NON_FINITE = new Set(["Infinity", "-Infinity", "NaN"]);

/** A generated JSON file, or a JSON block, decoded where the test reads it. */
const parseJson = Schema.decodeSync(Schema.fromJsonString(Schema.Json));

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

const children = (value: Schema.Json): readonly Schema.Json[] => {
  if (isJsonArray(value)) {
    return value;
  }

  return isJsonObject(value) ? Object.values(value) : [];
};

/** Every value nested anywhere in a JSON value, itself included. */
const nested = (value: Schema.Json): readonly Schema.Json[] => [
  value,
  ...children(value).flatMap(nested),
];

/** Whether a JSON Schema admits `null`, directly or through a union member. */
const admitsNull = (schema: Schema.Json): boolean => {
  if (!isJsonObject(schema)) {
    return false;
  }

  const { anyOf = [], oneOf = [], type = [] } = schema;

  const members = [anyOf, oneOf].flatMap((list) =>
    isJsonArray(list) ? list : []
  );

  return (
    type === "null" ||
    (isJsonArray(type) && type.includes("null")) ||
    members.some(admitsNull)
  );
};

/**
 * The two ways Effect's JSON Schema leaks a non-JSON value (AGENTS.md "Effect
 * traps"): a number that admits the strings "Infinity", "-Infinity" and
 * "NaN", and an optional key whose value may be `null`.
 */
const leaks = (schema: Schema.Json): readonly string[] =>
  nested(schema).flatMap((value) => {
    if (Predicate.isString(value) && NON_FINITE.has(value)) {
      return [`non-finite string ${value}`];
    }

    if (!isJsonObject(value)) {
      return [];
    }

    const { properties = {}, required = [] } = value;

    if (!isJsonObject(properties)) {
      return [];
    }

    const needed = new Set(isJsonArray(required) ? required : []);

    return Object.entries(properties).flatMap(([key, property]) =>
      !needed.has(key) && admitsNull(property)
        ? [`null under optional key ${key}`]
        : []
    );
  });

/** A pointer to a refusal's one definition, named for its encoded side. */
const ref = (tag: string) => ({ $ref: `#/$defs/${tag}Encoded` });

const content = (path: string) =>
  generate().find((file) => file.path === path)?.content ?? "";

const decodeCatalog = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CommandCatalog)
);

/** The JSON blocks in a Markdown page: here, each tool's schemas. */
const jsonBlocks = (markdown: string): readonly Schema.Json[] =>
  [...markdown.matchAll(/```json\n(?<body>[\s\S]*?)\n```/gu)].map((match) =>
    parseJson(match.groups?.body ?? "null")
  );

describe("generation", () => {
  it("writes exactly the five reference files, sorted by path", () => {
    expect(generate().map((file) => file.path)).toStrictEqual([
      "docs/reference/cli.md",
      "docs/reference/commands.json",
      "docs/reference/mcp-tools.md",
      "docs/reference/protocol.schema.json",
      "docs/reference/refusals.md",
    ]);
  });

  it("writes the same bytes every time", () => {
    expect(generate()).toStrictEqual(generate());
  });

  it("ends every file with one newline", () => {
    for (const file of generate()) {
      expect(file.content.endsWith("\n")).toBeTruthy();
      expect(file.content.endsWith("\n\n")).toBeFalsy();
    }
  });
});

describe("the leak finder", () => {
  it("flags both of Effect's known leaks", () => {
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
});

describe("the generated JSON Schema", () => {
  it("has a definition for each contract's payload, success and error, and the refusal union", () => {
    const document = parseJson(content("docs/reference/protocol.schema.json"));

    expect(document).toMatchObject({
      $defs: {
        Refusal: {
          anyOf: Refusal.members.map((member) => ref(member.identifier)),
        },
        // A contract with no refusals of its own can't fail that way.
        "listAsks.error": { not: {} },
        "listAsks.payload": { required: ["project"] },
        "listAsks.success": { required: ["asks"] },
        "submitAnswer.error": {
          anyOf: ["NotClaimed", "ClaimLapsed", "StaleBase", "RepoBusy"].map(
            ref
          ),
        },
        "submitAnswer.payload": { required: ["ask", "base", "head"] },
        "submitAnswer.success": { required: ["main"] },
      },
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
  });

  it("admits no non-finite number string and no null under an optional key", () => {
    expect(
      leaks(parseJson(content("docs/reference/protocol.schema.json")))
    ).toStrictEqual([]);
  });

  it("gives every MCP tool's input and output schema, with no leak in either", () => {
    const schemas = jsonBlocks(content("docs/reference/mcp-tools.md"));

    // Two tools, an input and an output each.
    expect(schemas).toHaveLength(4);
    expect(schemas.flatMap(leaks)).toStrictEqual([]);
  });
});

describe("the command catalog", () => {
  it.effect(
    "decodes with its own schema and lists the projected commands",
    () =>
      Effect.gen(function* () {
        const catalog = yield* decodeCatalog(
          content("docs/reference/commands.json")
        );

        expect(catalog.version).toBe(1);
        expect(catalog.commands).toMatchObject([
          {
            contract: "listAsks",
            destructive: false,
            idempotent: true,
            name: "asks",
            needsApproval: false,
            path: ["asks"],
            positional: [],
            readOnly: true,
            source: "projected",
            surfaces: ["rpc", "mcp", "cli", "web"],
          },
          {
            contract: "submitAnswer",
            destructive: false,
            idempotent: true,
            name: "submit",
            needsApproval: false,
            path: ["submit"],
            positional: [],
            readOnly: false,
            source: "projected",
            surfaces: ["rpc", "mcp", "cli", "web"],
          },
        ]);
        expect(
          catalog.commands.flatMap((command) => leaks(command.payloadSchema))
        ).toStrictEqual([]);
      })
  );

  it("is what the CLI reference is rendered from: each command with its flags", () => {
    const reference = content("docs/reference/cli.md");
    const submit = reference.slice(reference.indexOf("submit`"));

    expect(reference).toContain("asks`");
    expect(reference.slice(reference.indexOf("asks`"))).toContain(
      "`--project`"
    );

    for (const flag of ["`--ask`", "`--base`", "`--head`"]) {
      expect(submit).toContain(flag);
    }
  });
});

describe("the refusals reference", () => {
  it("gives each refusal's reason as the renderer words it", () => {
    const reference = content("docs/reference/refusals.md");

    const staleBase = reference.slice(
      reference.indexOf("### StaleBase"),
      reference.indexOf("## Checks")
    );

    expect(staleBase).toContain("main moved to");
    expect(reference.match(/^- Reason, for example: /gmu)).toHaveLength(
      reference.match(/^### /gmu)?.length ?? -1
    );
  });
});
