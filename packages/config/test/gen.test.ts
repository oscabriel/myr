import { describe, expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema, SchemaAST } from "effect";

import {
  Brand,
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

/** A generated file's text; empty when gen writes no such file. */
const content = (path: string) =>
  generate().pipe(
    Effect.map((files) => files.find((file) => file.path === path)?.content),
    Effect.map((text) => text ?? "")
  );

/** The JSON blocks in a Markdown page: here, each tool's schemas. */
const jsonBlocks = (markdown: string): readonly Schema.Json[] =>
  [...markdown.matchAll(/```json\n(?<body>[\s\S]*?)\n```/gu)].map((match) =>
    parseJson(match.groups?.body ?? "null")
  );

/** A Markdown page's `## ` sections, keyed by their heading, in order. */
const sections = (markdown: string): ReadonlyMap<string, string> =>
  new Map(
    [
      ...markdown.matchAll(
        /^## (?<heading>.+)\n(?<body>[\s\S]*?)(?=^## |(?![\s\S]))/gmu
      ),
    ].map((match) => [match.groups?.heading ?? "", match.groups?.body ?? ""])
  );

const decodeDefinitions = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({ $defs: Schema.Record(Schema.String, Schema.Json) })
  )
);

/** The definitions in protocol.schema.json, by name. */
const definitions = content("docs/reference/protocol.schema.json").pipe(
  Effect.map((text) => decodeDefinitions(text).$defs)
);

const decodeCatalog = Schema.decodeSync(Schema.fromJsonString(CommandCatalog));

const catalog = content("docs/reference/commands.json").pipe(
  Effect.map(decodeCatalog)
);

type Command = CommandCatalog["commands"][number];

/** A command's words after the CLI's name: `env set`. */
const words = ({ path }: Command) => path.join(" ");

/** The CLI reference's sections, by the command line each one heads. */
const cliSections = content("docs/reference/cli.md").pipe(
  Effect.map(
    (reference) =>
      new Map(
        [...sections(reference)].map(([heading, body]) => [
          heading.replace(/^`\S+ (?<path>.+)`$/u, "$<path>"),
          body,
        ])
      )
  )
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

const skill = `skills/${Brand.slug}/SKILL.md`;

const plugin = `plugins/${Brand.slug}`;

/** The fields the Agent Skills spec allows at a SKILL.md's top level. */
const skillFields = new Set([
  "allowed-tools",
  "compatibility",
  "description",
  "license",
  "metadata",
  "name",
]);

/** A SKILL.md split at its frontmatter: the keys at its top, its metadata, its body. */
const skillParts = (file: string) => {
  const { body = "", head = "" } =
    /^---\n(?<head>[\s\S]*?)\n---\n(?<body>[\s\S]*)$/u.exec(file)?.groups ?? {};

  const lines = head.split("\n");

  return {
    body,
    metadata: new Map(
      lines.flatMap((line) => {
        const { key, value } =
          /^ {2}(?<key>[a-z-]+): "(?<value>.*)"$/u.exec(line)?.groups ?? {};

        return key === undefined || value === undefined ? [] : [[key, value]];
      })
    ),
    name: /^name: (?<name>.+)$/mu.exec(head)?.groups?.name,
    top: lines.flatMap(
      (line) => /^(?<key>[a-z-]+):/u.exec(line)?.groups?.key ?? []
    ),
  };
};

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/** `sha256:<hex>` of a text's UTF-8 bytes, through WebCrypto. */
const sha256 = (text: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  ).pipe(Effect.map((digest) => `sha256:${hex(digest)}`));

/** Every `command` string anywhere in a JSON value. */
const commandsIn = (value: Schema.Json): readonly string[] =>
  nested(value).flatMap((item) =>
    isJsonObject(item) && Predicate.isString(item.command) ? [item.command] : []
  );

describe("generation", () => {
  it.effect(
    "writes the reference files, the platform's skill and its plugin, sorted by path",
    () =>
      Effect.gen(function* () {
        const files = yield* generate();

        expect(files.map((file) => file.path)).toStrictEqual([
          "docs/reference/cli.md",
          "docs/reference/commands.json",
          "docs/reference/mcp-tools.md",
          "docs/reference/protocol.schema.json",
          "docs/reference/refusals.md",
          `${plugin}/.claude-plugin/plugin.json`,
          `${plugin}/.mcp.json`,
          `${plugin}/hooks/hooks.json`,
          `${plugin}/mcp.json`,
          `${plugin}/plugin.json`,
          `${plugin}/skills/${Brand.slug}/SKILL.md`,
          skill,
        ]);
      })
  );

  it.effect("writes the same bytes every time", () =>
    Effect.gen(function* () {
      const first = yield* generate();
      const second = yield* generate();

      expect(first).toHaveLength(12);
      expect(second).toStrictEqual(first);
    })
  );

  it.effect("ends every file with one newline", () =>
    Effect.gen(function* () {
      for (const file of yield* generate()) {
        expect(file.content.endsWith("\n")).toBeTruthy();
        expect(file.content.endsWith("\n\n")).toBeFalsy();
      }
    })
  );
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
  it.effect("defines each contract's payload, success and error", () =>
    Effect.gen(function* () {
      const defined = new Set(Object.keys(yield* definitions));

      const missing = contracts
        .flatMap((rpc) =>
          ["payload", "success", "error"].map((part) => `${rpc._tag}.${part}`)
        )
        .filter((name) => !defined.has(name));

      expect(contracts).not.toHaveLength(0);
      expect(missing).toStrictEqual([]);
    })
  );

  it.effect(
    "defines each refusal once, and points the union and a contract's errors at it",
    () =>
      Effect.gen(function* () {
        const document = parseJson(
          yield* content("docs/reference/protocol.schema.json")
        );

        const $defs = yield* definitions;
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
          ["NotClaimed", "ClaimLapsed", "StaleBase", "RepoBusy"].flatMap(
            (tag) => (pointedAt.has(ref(tag).$ref) ? [] : [tag])
          )
        ).toStrictEqual([]);
        expect(
          ["ask", "base", "head"].flatMap((field) =>
            fields.has(field) ? [] : [field]
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "says a contract with no refusals of its own can't fail that way",
    () =>
      Effect.gen(function* () {
        const $defs = yield* definitions;

        const infallible = contracts.flatMap((rpc) =>
          SchemaAST.isNever(partsOf(rpc).error.ast) ? [rpc._tag] : []
        );

        expect(infallible).not.toHaveLength(0);
        expect(infallible.map((tag) => $defs[`${tag}.error`])).toStrictEqual(
          infallible.map(() => ({ not: {} }))
        );
      })
  );

  // `watch` streams: what it sends is a run of project events, and it can
  // still be refused before the first one.
  it.effect(
    "defines a stream's success as one of its elements, and its error as the stream's",
    () =>
      Effect.gen(function* () {
        const $defs = yield* definitions;

        expect(JSON.stringify($defs["watch.success"])).toContain('"AskOpened"');
        expect($defs["watch.error"]).toStrictEqual(ref("UnknownProject"));
      })
  );

  it.effect(
    "admits no non-finite number string and no null under an optional key",
    () =>
      Effect.gen(function* () {
        expect(
          leaks(
            parseJson(yield* content("docs/reference/protocol.schema.json"))
          )
        ).toStrictEqual([]);
      })
  );

  // A stream has no tool form, and a write-only value or a lane's log
  // must never pass through an agent's transcript.
  it.effect(
    "lists only the tools MCP serves: no watch, no setEnv, no evidence",
    () =>
      Effect.gen(function* () {
        const tools = [
          ...sections(yield* content("docs/reference/mcp-tools.md")).keys(),
        ];

        expect(tools).toContain("listProjects");
        expect(tools).toContain("submitAnswer");
        expect(
          ["watch", "setEnv", "evidence"].filter((tag) => tools.includes(tag))
        ).toStrictEqual([]);
        expect(tools).toHaveLength(contracts.length - 3);
      })
  );

  it.effect(
    "gives every MCP tool's input and output schema, with no leak in either",
    () =>
      Effect.gen(function* () {
        const reference = yield* content("docs/reference/mcp-tools.md");
        const schemas = jsonBlocks(reference);

        // An input and an output for each tool.
        expect(sections(reference).size).toBeGreaterThan(0);
        expect(schemas).toHaveLength(2 * sections(reference).size);
        expect(schemas.flatMap(leaks)).toStrictEqual([]);
      })
  );
});

describe("the command catalog", () => {
  it.effect(
    "has a row for every command, from a contract or written by hand, sorted by its words",
    () =>
      Effect.gen(function* () {
        const { commands, version } = yield* catalog;
        const order = commands.map(words);

        const byName = new Map(
          commands.map((command) => [words(command), command])
        );

        expect(version).toBe(1);
        expect(byName.get("asks")).toMatchObject({
          contract: "listAsks",
          destructive: false,
          idempotent: true,
          needsApproval: false,
          path: ["asks"],
          positional: [],
          readOnly: true,
          source: "contract",
          surfaces: ["rpc", "mcp", "cli", "web"],
        });
        expect(
          [
            "check",
            "login",
            "init",
            "why",
            "env set",
            "hook",
            "credential",
            "mcp",
            "schema",
          ].map((name) => [name, byName.get(name)?.source])
        ).toStrictEqual([
          ["check", "local"],
          ["login", "local"],
          ["init", "local"],
          ["why", "local"],
          ["env set", "local"],
          ["hook", "local"],
          ["credential", "local"],
          ["mcp", "local"],
          ["schema", "local"],
        ]);
        // Sorted by the words, so `ask` and its subcommands sit before `asks`.
        expect(
          order.filter(
            (name) => name.startsWith("ask") || name.startsWith("env")
          )
        ).toStrictEqual([
          "ask",
          "ask flag",
          "ask open",
          "asks",
          "env set",
          "env shape",
        ]);
        expect(order).toStrictEqual(order.toSorted());
      })
  );

  it.effect(
    "gives a contract's row its flags, its contract's hints and its payload",
    () =>
      Effect.gen(function* () {
        const { commands } = yield* catalog;
        const submit = commands.find((command) => words(command) === "submit");

        expect(submit).toMatchObject({
          contract: "submitAnswer",
          destructive: false,
          idempotent: true,
          needsApproval: false,
          path: ["submit"],
          readOnly: false,
          source: "contract",
        });
        expect(submit?.flags).toContain("--head");
        expect(submit?.flags).toContain("--json");
        expect(submit?.flags).toContain("--dry-run");
        expect(
          commands.flatMap((command) =>
            command.payloadSchema === undefined
              ? []
              : leaks(command.payloadSchema)
          )
        ).toStrictEqual([]);
      })
  );

  // `init` and `env set` do local work around the contract they call, so
  // their hand-written rows stand for those contracts.
  it.effect(
    "gives a contract a hand-written command calls no row of its own",
    () =>
      Effect.gen(function* () {
        const { commands } = yield* catalog;

        const calling = (contract: string) =>
          commands.flatMap((command) =>
            command.contract === contract
              ? [`${words(command)} (${command.source})`]
              : []
          );

        const envSet = commands.find((command) => words(command) === "env set");

        expect(calling("initProject")).toStrictEqual(["init (local)"]);
        expect(calling("setEnv")).toStrictEqual(["env set (local)"]);
        expect(envSet).toMatchObject({
          needsApproval: true,
          positional: ["key"],
          surfaces: ["cli"],
        });
        // The CLI's own flag names, not the payload's: the value never is one.
        expect(envSet?.flags).toStrictEqual([
          "--project",
          "--acknowledge-short",
          "--yes",
          "--dry-run",
          "--json",
        ]);
      })
  );
});

describe("the CLI reference", () => {
  it.effect(
    "has one section per command, in the catalog's order, naming its flags and arguments",
    () =>
      Effect.gen(function* () {
        const { commands } = yield* catalog;
        const byPath = yield* cliSections;

        const unnamed = commands.flatMap((command) => {
          const body = byPath.get(words(command)) ?? "";

          return [
            ...command.positional.map((field) => `<${field}>`),
            ...command.flags,
          ].flatMap((argument) =>
            body.includes(`\`${argument}\``)
              ? []
              : [`${words(command)} ${argument}`]
          );
        });

        expect(commands.length).toBeGreaterThan(20);
        expect([...byPath.keys()]).toStrictEqual(commands.map(words));
        expect(unnamed).toStrictEqual([]);
      })
  );

  it.effect(
    "gives a contract's arguments with what each takes, and a hand-written command's by name",
    () =>
      Effect.gen(function* () {
        const byPath = yield* cliSections;

        expect(byPath.get("submit")).toContain("| `--head` | text | yes |");
        expect(byPath.get("why")).toContain("- Arguments: `<location>`");
        expect(byPath.get("why")).toContain(
          `\`${Brand.cli} why --help\` says what each one takes.`
        );
        expect(byPath.get("env set")).toContain("`--acknowledge-short`");
        expect(byPath.get("env set")).not.toContain("--value");
      })
  );

  // The CLI fills a contract's `--project` from the repo's remote, so a
  // person inside a project's repo may leave it out.
  it.effect("writes a contract's --project as filled from the repo", () =>
    Effect.gen(function* () {
      const asks = (yield* cliSections).get("asks") ?? "";

      expect(asks).toContain(`${Brand.cli} asks [--project <project>]`);
      expect(asks).toContain(
        "| `--project` | text | no: the project of the repo you stand in |"
      );
    })
  );

  // The CLI takes `--json`, `--yes` and `--dry-run` as switches that default
  // to off, so none is required and none takes a value.
  it.effect("writes the CLI's switches as optional, taking no value", () =>
    Effect.gen(function* () {
      const vouch = (yield* cliSections).get("vouch") ?? "";

      for (const flag of ["--json", "--yes", "--dry-run"]) {
        expect(vouch).toContain(` [${flag}]`);
        expect(vouch).toContain(`| \`${flag}\` | nothing (a switch) | no |`);
      }
    })
  );

  // A table cell ends at any pipe Markdown doesn't see escaped, so a choice
  // written `"a" | "b"` would push its row past the table's three columns.
  it.effect(
    "keeps every argument row to its three columns, a choice's values included",
    () =>
      Effect.gen(function* () {
        const rows = (yield* content("docs/reference/cli.md"))
          .split("\n")
          .filter((line) => line.startsWith("| `"));

        const split = rows.flatMap((row) =>
          row.split(/(?<!\\)\|/u).length === 5 ? [] : [row]
        );

        expect(rows).not.toHaveLength(0);
        expect(split).toStrictEqual([]);
        expect(rows).toContain(
          '| `--verdict` | "vouch" \\| "denounce" | yes |'
        );
      })
  );
});

describe("the platform's skill", () => {
  it.effect(
    "keeps to the Agent Skills fields, and records its body's SHA-256 under metadata",
    () =>
      Effect.gen(function* () {
        const { body, metadata, name, top } = skillParts(yield* content(skill));

        expect(top.filter((key) => !skillFields.has(key))).toStrictEqual([]);
        expect(top).toStrictEqual(["name", "description", "metadata"]);
        expect(name).toBe(Brand.slug);
        expect(metadata.get("managed-by")).toBe(Brand.slug);
        expect(metadata.get("content-hash")).toBe(yield* sha256(body));
      })
  );

  it.effect("lists every command, with its arguments", () =>
    Effect.gen(function* () {
      const { body } = skillParts(yield* content(skill));
      const { commands } = yield* catalog;

      const missing = commands.flatMap((command) => {
        const usage = [
          Brand.cli,
          ...command.path,
          ...command.positional.map((field) => `<${field}>`),
        ].join(" ");

        return body.includes(`| \`${usage}\` |`) ? [] : [usage];
      });

      expect(commands.length).toBeGreaterThan(20);
      expect(missing).toStrictEqual([]);
    })
  );

  it.effect("is the same file inside the plugin", () =>
    Effect.gen(function* () {
      const own = yield* content(skill);

      expect(own).not.toBe("");
      expect(yield* content(`${plugin}/skills/${Brand.slug}/SKILL.md`)).toBe(
        own
      );
    })
  );
});

describe("the plugin", () => {
  it.effect("has manifests and configs that parse as JSON", () =>
    Effect.gen(function* () {
      for (const path of [
        `${plugin}/.claude-plugin/plugin.json`,
        `${plugin}/plugin.json`,
        `${plugin}/hooks/hooks.json`,
        `${plugin}/.mcp.json`,
        `${plugin}/mcp.json`,
      ]) {
        expect(isJsonObject(parseJson(yield* content(path)))).toBeTruthy();
      }

      expect(
        parseJson(yield* content(`${plugin}/.claude-plugin/plugin.json`))
      ).toMatchObject({ name: Brand.slug });
      expect(parseJson(yield* content(`${plugin}/plugin.json`))).toMatchObject({
        name: Brand.slug,
      });
    })
  );

  it.effect(
    "runs the CLI's hook at session start, before a tool runs, and at stop",
    () =>
      Effect.gen(function* () {
        const hooks = parseJson(yield* content(`${plugin}/hooks/hooks.json`));

        expect(commandsIn(hooks).toSorted()).toStrictEqual([
          `${Brand.cli} hook pre-tool-use --json`,
          `${Brand.cli} hook session-start --json`,
          `${Brand.cli} hook stop --json`,
        ]);
      })
  );

  // No deploy URL exists yet, so MCP runs through the CLI over stdio.
  it.effect("reaches MCP through the CLI, with no platform URL", () =>
    Effect.gen(function* () {
      const claude = parseJson(yield* content(`${plugin}/.mcp.json`));
      const agents = parseJson(yield* content(`${plugin}/mcp.json`));
      const manifest = yield* content(`${plugin}/.claude-plugin/plugin.json`);

      expect(claude).toStrictEqual({
        mcpServers: { [Brand.slug]: { args: ["mcp"], command: Brand.cli } },
      });
      expect(agents).toMatchObject({
        mcpServers: {
          [Brand.slug]: { args: ["mcp"], command: Brand.cli, type: "stdio" },
        },
      });
      expect(manifest).not.toContain("homepage");
    })
  );
});

describe("the refusals reference", () => {
  it.effect("gives each refusal's reason as the renderer words it", () =>
    Effect.gen(function* () {
      const reference = yield* content("docs/reference/refusals.md");

      const staleBase = reference.slice(
        reference.indexOf("### StaleBase"),
        reference.indexOf("## Checks")
      );

      expect(staleBase).toContain("main moved to");
      expect(reference.match(/^- Reason, for example: /gmu)).toHaveLength(
        reference.match(/^### /gmu)?.length ?? -1
      );
    })
  );
});
