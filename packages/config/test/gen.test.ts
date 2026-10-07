import { describe, expect, it } from "@effect/vitest";
import { Predicate, Schema, SchemaAST } from "effect";

import {
  CommandCatalog,
  Contracts,
  generate,
  partsOf,
  Refusal,
} from "../../../scripts/lib/gen.ts";

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

/** The JSON blocks in a Markdown page: here, each tool's schemas. */
const jsonBlocks = (markdown: string): readonly Schema.Json[] =>
  [...markdown.matchAll(/```json\n(?<body>[\s\S]*?)\n```/gu)].map((match) =>
    parseJson(match.groups?.body ?? "null")
  );

/** A Markdown page's `## ` sections, keyed by their heading. */
const sections = (markdown: string): ReadonlyMap<string, string> =>
  new Map(
    [
      ...markdown.matchAll(
        /^## (?<heading>.+)\n(?<body>[\s\S]*?)(?=^## |(?![\s\S]))/gmu
      ),
    ].map((match) => [match.groups?.heading ?? "", match.groups?.body ?? ""])
  );

/** The definitions in protocol.schema.json, by name. */
const definitions = () =>
  Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({ $defs: Schema.Record(Schema.String, Schema.Json) })
    )
  )(content("docs/reference/protocol.schema.json")).$defs;

const catalog = () =>
  Schema.decodeSync(Schema.fromJsonString(CommandCatalog))(
    content("docs/reference/commands.json")
  );

/** The fields a command's payload schema names; a command may take none. */
const payloadFields = Schema.decodeUnknownSync(
  Schema.Struct({
    properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  })
);

/** A union of pointers, as a contract's error is written. */
const decodeUnion = Schema.decodeUnknownSync(
  Schema.Struct({ anyOf: Schema.Array(Schema.Struct({ $ref: Schema.String })) })
);

/** An object schema's required keys. */
const decodeObject = Schema.decodeUnknownSync(
  Schema.Struct({ required: Schema.Array(Schema.String) })
);

const contracts = [...Contracts.requests.values()];

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
  it("defines each contract's payload, success and error", () => {
    const defined = new Set(Object.keys(definitions()));

    const missing = contracts
      .flatMap((rpc) =>
        ["payload", "success", "error"].map((part) => `${rpc._tag}.${part}`)
      )
      .filter((name) => !defined.has(name));

    expect(contracts).not.toHaveLength(0);
    expect(missing).toStrictEqual([]);
  });

  it("defines each refusal once, and points the union and a contract's errors at it", () => {
    const document = parseJson(content("docs/reference/protocol.schema.json"));
    const $defs = definitions();
    const { anyOf } = decodeUnion($defs["submitAnswer.error"]);
    const { required } = decodeObject($defs["submitAnswer.payload"]);

    const pointedAt = new Set(anyOf.map((member) => member.$ref));
    const fields = new Set(required);

    expect(document).toMatchObject({
      $defs: {
        Refusal: {
          anyOf: Refusal.members.map((member) => ref(member.identifier)),
        },
        "listAsks.payload": { required: ["project"] },
        "listAsks.success": { required: ["asks"] },
      },
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
    // Later contracts may widen submitAnswer; what it has now must stay.
    expect(
      ["NotClaimed", "ClaimLapsed", "StaleBase", "RepoBusy"].flatMap((tag) =>
        pointedAt.has(ref(tag).$ref) ? [] : [tag]
      )
    ).toStrictEqual([]);
    expect(
      ["ask", "base", "head"].flatMap((field) =>
        fields.has(field) ? [] : [field]
      )
    ).toStrictEqual([]);
  });

  it("says a contract with no refusals of its own can't fail that way", () => {
    const $defs = definitions();

    const infallible = contracts.flatMap((rpc) =>
      SchemaAST.isNever(partsOf(rpc).error.ast) ? [rpc._tag] : []
    );

    expect(infallible).not.toHaveLength(0);
    expect(infallible.map((tag) => $defs[`${tag}.error`])).toStrictEqual(
      infallible.map(() => ({ not: {} }))
    );
  });

  // `watch` streams: what it sends is a run of project events, and it can
  // still be refused before the first one.
  it("defines a stream's success as one of its elements, and its error as the stream's", () => {
    const $defs = definitions();

    expect(JSON.stringify($defs["watch.success"])).toContain('"AskOpened"');
    expect($defs["watch.error"]).toStrictEqual(ref("UnknownProject"));
  });

  it("admits no non-finite number string and no null under an optional key", () => {
    expect(
      leaks(parseJson(content("docs/reference/protocol.schema.json")))
    ).toStrictEqual([]);
  });

  // A stream has no tool form, and a write-only value must never pass
  // through an agent's transcript.
  it("lists only the tools MCP serves: no watch, no setEnv", () => {
    const tools = [...sections(content("docs/reference/mcp-tools.md")).keys()];

    expect(tools).toContain("listProjects");
    expect(tools).toContain("submitAnswer");
    expect(tools).not.toContain("watch");
    expect(tools).not.toContain("setEnv");
    expect(tools).toHaveLength(contracts.length - 2);
  });

  it("gives every MCP tool's input and output schema, with no leak in either", () => {
    const reference = content("docs/reference/mcp-tools.md");
    const schemas = jsonBlocks(reference);

    // An input and an output for each tool.
    expect(sections(reference).size).toBeGreaterThan(0);
    expect(schemas).toHaveLength(2 * sections(reference).size);
    expect(schemas.flatMap(leaks)).toStrictEqual([]);
  });
});

describe("the command catalog", () => {
  it("decodes with its own schema and lists asks and submit", () => {
    const { commands, version } = catalog();

    const byName = new Map(commands.map((command) => [command.name, command]));

    expect(version).toBe(1);
    expect(byName.get("asks")).toMatchObject({
      contract: "listAsks",
      destructive: false,
      idempotent: true,
      needsApproval: false,
      path: ["asks"],
      positional: [],
      readOnly: true,
      source: "projected",
      surfaces: ["rpc", "mcp", "cli", "web"],
    });
    expect(byName.get("submit")).toMatchObject({
      contract: "submitAnswer",
      destructive: false,
      idempotent: true,
      needsApproval: false,
      path: ["submit"],
      readOnly: false,
      source: "projected",
    });
    expect(
      commands.flatMap((command) => leaks(command.payloadSchema))
    ).toStrictEqual([]);
  });

  it("is what the CLI reference is rendered from: every command, with its arguments", () => {
    const { commands } = catalog();

    // A heading is the command line in backticks: the CLI's name, then the path.
    const byPath = new Map(
      [...sections(content("docs/reference/cli.md"))].map(([heading, body]) => [
        heading.replace(/^`\S+ (?<path>.+)`$/u, "$<path>"),
        body,
      ])
    );

    const unrendered = commands.flatMap((command) => {
      const path = command.path.join(" ");
      const body = byPath.get(path) ?? "";
      const positional = new Set(command.positional);
      const { properties = {} } = payloadFields(command.payloadSchema);

      return [
        ...command.positional.map((field) => `<${field}>`),
        ...Object.keys(properties).flatMap((field) =>
          positional.has(field) ? [] : [`--${field}`]
        ),
      ].flatMap((argument) =>
        body.includes(`| \`${argument}\` |`) ? [] : [`${path} ${argument}`]
      );
    });

    expect([...byPath.keys()]).toStrictEqual(
      commands.map((command) => command.path.join(" "))
    );
    expect(unrendered).toStrictEqual([]);
    // Known rows, so an empty catalog can't pass.
    expect(byPath.get("asks")).toContain("| `--project` | text | yes |");
    expect(byPath.get("submit")).toContain("| `--head` | text | yes |");
  });

  // The CLI takes a boolean as a switch that defaults to off, so it is never
  // required and takes no value.
  it("writes a boolean field as an optional switch", () => {
    const [, envSet = ""] =
      [...sections(content("docs/reference/cli.md"))].find(([heading]) =>
        heading.endsWith(" env set`")
      ) ?? [];

    expect(envSet).toContain(" [--acknowledgeShort]");
    expect(envSet).not.toContain("<acknowledgeShort>");
    expect(envSet).toContain(
      "| `--acknowledgeShort` | nothing (a switch) | no |"
    );
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
