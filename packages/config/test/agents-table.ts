/**
 * The agents-table check's core (AGENTS.md principle 1): every enforcer the
 * principles table names under "Held by" must exist in the repo and be on.
 *
 * Only the table under `## Principles` is read, and in it only the "Held by"
 * cells, each up to "No fence yet". Each backticked enforcer there is
 * classified by its shape, then looked up:
 *
 * - a path, glob or folder (`scripts/gen.ts`, `docs/adr/*.md`,
 *   `.pi/extensions/vcs-policy/`): a file git tracks, or a new one it doesn't
 *   ignore, matches it;
 * - a root script (`gen:check`, `verify`, `bun run debt`): a key of the root
 *   `package.json`'s `scripts`;
 * - a lint rule (`fence/no-x`, or bare `no-x`): set to error in
 *   `oxlint.config.ts`, at its top level or in an override;
 * - an Effect diagnostic or a config key (camelCase): at error in
 *   `tsconfig.base.json`'s `diagnosticSeverity`, or a key elsewhere in it;
 * - a refusal or an id (PascalCase): a refusal class in `refusal.ts`, or an
 *   export of `ids.ts`, in `packages/protocol/src/`.
 *
 * Anything else is unclassified, and fails.
 */
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { DummyRule, OxlintConfig } from "oxlint";

import oxlintConfig from "../../../oxlint.config.ts";

/** What the repo holds that a "Held by" cell may name. */
export interface Repo {
  /** Every file git tracks or would add, relative to the repo root. */
  readonly files: readonly string[];
  /** The root `package.json`'s script names. */
  readonly scripts: readonly string[];
  /** The plugins oxlint runs, built in or from JavaScript. */
  readonly lintPlugins: readonly string[];
  readonly lintRulesAtError: readonly string[];
  readonly diagnosticsAtError: readonly string[];
  /** Every key in `tsconfig.base.json`, except diagnostics' names. */
  readonly configKeys: readonly string[];
  readonly refusals: readonly string[];
  readonly ids: readonly string[];
}

/** One principle's row: its number and the enforcers it claims. */
export interface Row {
  readonly principle: string;
  readonly enforcers: readonly string[];
}

type Kind =
  | "file"
  | "script"
  | "lint rule"
  | "diagnostic"
  | "config key"
  | "refusal"
  | "id";

const CUT = "No fence yet";

const HELD_BY = "Held by";

const SECTION = /^## Principles\s*$/u;

const HEADING = /^#{1,2} /u;

const BACKTICKED = /`(?<enforcer>[^`]+)`/gu;

const UNESCAPED_PIPE = /(?<!\\)\|/u;

const BUN_RUN = /^bun run (?<script>\S+)/u;

const PLUGIN_RULE = /^(?<plugin>[a-z][a-z0-9-]*)\/[a-z][a-z0-9-]*$/u;

const GLOB = /[*?{]/u;

const EXTENSION = /\.[a-z0-9]+$/u;

const SCRIPT = /^[a-z][a-z0-9]*(?::[a-z0-9-]+)*$/u;

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/u;

const CAMEL = /^[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+$/u;

const PASCAL = /^[A-Z][A-Za-z0-9]*$/u;

/** A table line's cells, trimmed, with `\|` read as a pipe inside a cell. */
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split(UNESCAPED_PIPE)
    .map((cell) => cell.trim().replaceAll(String.raw`\|`, "|"));

/** The backticked enforcers in a "Held by" cell, before "No fence yet". */
const enforcersIn = (cell: string) =>
  Array.from(
    (cell.split(CUT)[0] ?? "").matchAll(BACKTICKED),
    (match) => match.groups?.enforcer ?? ""
  );

/**
 * Each row of the first table under `## Principles` whose header has a
 * "Held by" column. No such table: no rows.
 */
export const principleRows = (markdown: string): readonly Row[] => {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => SECTION.test(line));

  if (start === -1) {
    return [];
  }

  const end = lines.findIndex(
    (line, index) => index > start && HEADING.test(line)
  );

  const section = lines.slice(start + 1, end === -1 ? undefined : end);

  const header = section.findIndex(
    (line) => line.startsWith("|") && cellsOf(line).includes(HELD_BY)
  );

  if (header === -1) {
    return [];
  }

  const columns = cellsOf(section[header] ?? "");
  const heldBy = columns.indexOf(HELD_BY);
  const numbered = columns.indexOf("#");
  const body = section.slice(header + 2);
  const last = body.findIndex((line) => !line.startsWith("|"));

  return body
    .slice(0, last === -1 ? undefined : last)
    .map(cellsOf)
    .map((cells, index) => ({
      enforcers: enforcersIn(cells[heldBy] ?? ""),
      principle: cells[numbered] ?? String(index + 1),
    }));
};

const GLOB_PART = /\{[^{}]*\}|\*\*\/|\*\*|\*|\?|[.+^$()|[\]{}\\]/gu;

const WILDCARDS = new Map([
  ["*", "[^/]*"],
  ["**", ".*"],
  ["**/", "(?:.*/)?"],
  ["?", "[^/]"],
]);

const escapeRegExp = (text: string) =>
  text.replaceAll(/[.+^$()|[\]{}\\*?]/gu, String.raw`\$&`);

/** One part of a glob as a pattern: a wildcard, `{a,b}`, or one literal character. */
const globPart = (part: string) => {
  const wildcard = WILDCARDS.get(part);

  if (wildcard !== undefined) {
    return wildcard;
  }

  return part.length > 1
    ? `(?:${part.slice(1, -1).split(",").map(escapeRegExp).join("|")})`
    : escapeRegExp(part);
};

/** `*` and `?` stay inside one folder, `**` crosses folders, `{a,b}` is either. */
const globPattern = (glob: string) =>
  new RegExp(`^${glob.replaceAll(GLOB_PART, globPart)}$`, "u");

/** A path matches itself, a folder (with or without its slash) its files. */
const matchesFile = (token: string, files: readonly string[]) => {
  if (GLOB.test(token)) {
    const pattern = globPattern(token);

    return files.some((file) => pattern.test(file));
  }

  const folder = token.endsWith("/") ? token : `${token}/`;

  return files.some((file) => file === token || file.startsWith(folder));
};

/** `fence/no-x` matches itself; a bare `no-x` matches it under any plugin. */
const matchesRule = (token: string, rules: readonly string[]) =>
  rules.some((rule) => rule === token || rule.endsWith(`/${token}`));

const holds: Readonly<Record<Kind, (token: string, repo: Repo) => boolean>> = {
  "config key": (token, repo) => repo.configKeys.includes(token),
  diagnostic: (token, repo) => repo.diagnosticsAtError.includes(token),
  file: (token, repo) => matchesFile(token, repo.files),
  id: (token, repo) => repo.ids.includes(token),
  "lint rule": (token, repo) => matchesRule(token, repo.lintRulesAtError),
  refusal: (token, repo) => repo.refusals.includes(token),
  script: (token, repo) =>
    repo.scripts.includes(BUN_RUN.exec(token)?.groups?.script ?? token),
};

const described: Readonly<Record<Kind, string>> = {
  "config key": "key in tsconfig.base.json",
  diagnostic: "Effect diagnostic at error in tsconfig.base.json",
  file: "file",
  id: "id exported from packages/protocol/src/ids.ts",
  "lint rule": "lint rule at error in oxlint.config.ts",
  refusal: "refusal class in packages/protocol/src/refusal.ts",
  script: "root package.json script",
};

/** What an enforcer could be, by its shape alone; none if it has no known shape. */
const kindsOf = (token: string, repo: Repo): readonly Kind[] => {
  if (BUN_RUN.test(token)) {
    return ["script"];
  }

  if (/\s/u.test(token)) {
    return [];
  }

  const plugin = PLUGIN_RULE.exec(token)?.groups?.plugin;

  if (plugin !== undefined && repo.lintPlugins.includes(plugin)) {
    return ["lint rule"];
  }

  if (
    token.includes("/") ||
    token.startsWith(".") ||
    GLOB.test(token) ||
    EXTENSION.test(token)
  ) {
    return ["file"];
  }

  if (SCRIPT.test(token)) {
    return ["script"];
  }

  if (KEBAB.test(token)) {
    return ["lint rule", "script"];
  }

  if (CAMEL.test(token)) {
    return ["diagnostic", "config key"];
  }

  return PASCAL.test(token) ? ["refusal", "id"] : [];
};

/** One line for each enforcer in `row` that the repo doesn't hold. */
export const missingEnforcers = (row: Row, repo: Repo): readonly string[] =>
  row.enforcers.flatMap((token) => {
    const kinds = kindsOf(token, repo);

    if (kinds.length === 0) {
      return [
        `unclassified enforcer \`${token}\` in principle ${row.principle}; name a file, script, rule, diagnostic or tag`,
      ];
    }

    return kinds.some((kind) => holds[kind](token, repo))
      ? []
      : [
          `principle ${row.principle} names \`${token}\`, but the repo has no such ${kinds
            .map((kind) => described[kind])
            .join(" or ")}`,
        ];
  });

const isError = (setting: DummyRule | undefined) => {
  const severity = Array.isArray(setting) ? setting[0] : setting;

  return severity === "error" || severity === "deny" || severity === 2;
};

/** A config, then each config it extends, innermost first. */
const layersOf = (config: OxlintConfig): readonly OxlintConfig[] => [
  ...(config.extends ?? []).flatMap(layersOf),
  config,
];

/** The rules oxlint runs at error: top level (a later layer wins) or in an override. */
const rulesAtError = (config: OxlintConfig) => {
  const layers = layersOf(config);

  const topLevel = new Map(
    layers.flatMap((layer) => Object.entries(layer.rules ?? {}))
  );

  const overridden = layers.flatMap((layer) =>
    (layer.overrides ?? []).flatMap((override) =>
      Object.entries(override.rules ?? {})
    )
  );

  return [...topLevel, ...overridden].flatMap(([rule, setting]) =>
    isError(setting) ? [rule] : []
  );
};

/** Built-in plugins each layer turns on, and each JavaScript plugin's name. */
const pluginsOf = (config: OxlintConfig) =>
  layersOf(config).flatMap((layer) => [
    ...(layer.plugins ?? []),
    ...(layer.jsPlugins ?? []).map((plugin) =>
      Schema.is(Schema.String)(plugin) ? plugin : plugin.name
    ),
  ]);

const isJsonArray = Schema.is(Schema.Array(Schema.Json));

const isJsonObject = Schema.is(Schema.JsonObject);

/** Every key in a JSON document, except the diagnostics' names. */
const keysOf = (json: Schema.Json): readonly string[] => {
  if (isJsonArray(json)) {
    return json.flatMap(keysOf);
  }

  if (isJsonObject(json)) {
    return Object.entries(json).flatMap(([key, value]) => [
      key,
      ...(key === "diagnosticSeverity" ? [] : keysOf(value)),
    ]);
  }

  return [];
};

const RootPackage = Schema.Struct({
  scripts: Schema.Record(Schema.String, Schema.String),
});

const TsconfigBase = Schema.Struct({
  compilerOptions: Schema.Struct({
    plugins: Schema.Array(
      Schema.Struct({
        diagnosticSeverity: Schema.optionalKey(
          Schema.Record(Schema.String, Schema.String)
        ),
      })
    ),
  }),
});

const REFUSAL_CLASS =
  /\bclass\s+(?<name>[A-Z][A-Za-z0-9]*)\s+extends\s+Schema\.TaggedError\b/gu;

const EXPORTED =
  /^export\s+(?:const|type|interface|class)\s+(?<name>[A-Z][A-Za-z0-9]*)/gmu;

const namesIn = (source: string, pattern: RegExp) => [
  ...new Set(
    Array.from(source.matchAll(pattern), (match) => match.groups?.name ?? "")
  ),
];

/** AGENTS.md's text, and what the repo holds, read from the repo root. */
export const readAgentsTable = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // Vitest runs in the package's folder, two below the repo root.
  const root = path.resolve("..", "..");
  const read = (file: string) => fs.readFileString(path.join(root, file));

  const lsFiles = (...args: readonly string[]) =>
    spawner.lines(
      ChildProcess.make("git", ["ls-files", ...args], { cwd: root })
    );

  const [agents, rootPackage, tsconfigText, refusalSource, idsSource] =
    yield* Effect.all(
      [
        read("AGENTS.md"),
        read("package.json"),
        read("tsconfig.base.json"),
        read("packages/protocol/src/refusal.ts"),
        read("packages/protocol/src/ids.ts"),
      ],
      { concurrency: "unbounded" }
    );

  const listed = yield* lsFiles(
    "--cached",
    "--others",
    "--exclude-standard",
    "--deduplicate"
  );

  const deleted = new Set(yield* lsFiles("--deleted"));

  const { scripts } = yield* Schema.decodeEffect(
    Schema.fromJsonString(RootPackage)
  )(rootPackage);

  const tsconfig = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Json)
  )(tsconfigText);

  const { compilerOptions } =
    yield* Schema.decodeUnknownEffect(TsconfigBase)(tsconfig);

  const repo: Repo = {
    configKeys: [...new Set(keysOf(tsconfig))],
    diagnosticsAtError: compilerOptions.plugins.flatMap((plugin) =>
      Object.entries(plugin.diagnosticSeverity ?? {}).flatMap(
        ([diagnostic, severity]) => (severity === "error" ? [diagnostic] : [])
      )
    ),
    files: listed.filter((file) => file.length > 0 && !deleted.has(file)),
    ids: namesIn(idsSource, EXPORTED),
    lintPlugins: [...new Set(pluginsOf(oxlintConfig))],
    lintRulesAtError: [...new Set(rulesAtError(oxlintConfig))],
    refusals: namesIn(refusalSource, REFUSAL_CLASS),
    scripts: Object.keys(scripts),
  };

  return { repo, rows: principleRows(agents) };
});

/**
 * `readAgentsTable`, run once while vitest collects the tests: a test per
 * principle row needs the rows before any test runs, and `@effect/vitest`
 * runs Effects only inside a test.
 */
export const loadAgentsTable = () =>
  Effect.runPromise(readAgentsTable.pipe(Effect.provide(NodeServices.layer)));
