/**
 * The judge closure: every file that decides what an answer's checks do, so
 * no answer may change it (GLOSSARY "Judge closure"). It is data: globs, plus
 * JSON pointers into files an answer may still edit elsewhere, such as
 * `package.json#/scripts` beside its dependencies. Pure; it reads only the
 * file contents it is given.
 */
import { Brand } from "@repo/brand";
import { Glob } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import type { RunBlock } from "@repo/protocol/domain/run";
import { RepoPath } from "@repo/protocol/ids";
import { Equal, Option, Predicate, Result, Schema } from "effect";
import { parse } from "yaml";

import type { RepoFile } from "./finder.ts";

/** A closure glob that starts with this takes paths back out of the closure. */
const EXCLUDE = "!";

/**
 * Where each harness and git hook manager the platform knows keeps its hooks:
 * Claude Code, Cursor, Codex, GitHub Copilot, Gemini CLI, pi, OpenCode and
 * Amp; lefthook (and its scripts folder), husky and pre-commit. A hook runs in
 * every contributor's session, so an answer may not change one.
 */
export const hookConfigGlobs: readonly Glob[] = [
  ".claude/settings*.json",
  ".cursor/hooks.json",
  ".codex/hooks.json",
  ".codex/config.toml",
  ".github/hooks/*.json",
  ".github/copilot/settings.json",
  ".gemini/settings.json",
  ".pi/**",
  ".opencode/plugins/**",
  ".amp/plugins/**",
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
  ".lefthook.yaml",
  ".lefthook/**",
  ".husky/**",
  ".pre-commit-config.yaml",
].map((glob) => Glob.make(glob));

/**
 * The workspace and task-runner policy files, and formatter config: what a
 * package manager, a task runner or a formatter check reads before it runs
 * anything (bun's and pnpm's install policy, turbo's and nx's task graph,
 * yarn's own release and plugins). `.editorconfig` is not one: no check
 * reads it.
 */
export const policyFileGlobs: readonly Glob[] = [
  "**/bunfig.toml",
  "pnpm-workspace.yaml",
  "**/turbo.json",
  "**/turbo.jsonc",
  "nx.json",
  ".yarnrc.yml",
  ".yarn/plugins/**",
  ".yarn/releases/**",
  "**/oxfmt.config.*",
  "**/.oxfmtrc*",
  "**/biome.json*",
  "**/.prettierrc*",
  "**/prettier.config.*",
].map((glob) => Glob.make(glob));

/**
 * What every project's judge holds before its run block adds to it: the
 * config folder, the env schema and committed env files (never `*.local`
 * ones), CI, test and lint config, the tsconfig files, generated contribute
 * skills, the workspace and task-runner policy files, and every hook config.
 */
export const defaultJudgeGlobs: readonly Glob[] = [
  ...[
    `${Brand.configDir}/**`,
    "**/.env.schema",
    "**/.env.*",
    `${EXCLUDE}**/.env.local`,
    `${EXCLUDE}**/.env.*.local`,
    ".github/workflows/**",
    ".github/actions/**",
    ".forgejo/**",
    "**/vitest.config.*",
    "**/vitest.*.config.*",
    "**/vitest.workspace.*",
    "**/vite.config.*",
    "**/oxlint.config.*",
    "**/oxlint.*.config.*",
    "**/.oxlintrc*",
    "**/eslint.config.*",
    "**/eslint.*.config.*",
    "**/.eslintrc*",
    "**/tsconfig*.json",
    "tools/oxlint/**",
    ".agents/skills/*-contribute/**",
    ".claude/skills/*-contribute/**",
  ].map((glob) => Glob.make(glob)),
  ...policyFileGlobs,
  ...hookConfigGlobs,
];

const withoutDotSlash = (path: string) => path.replace(/^(?:\.\/)+/u, "");

// One path segment against one glob segment: `*` is any run of characters
// and `?` is one, never a `/`. Greedy, backing up to the last `*` on a miss.
const matchSegment = (pattern: string, text: string): boolean => {
  let at = 0;
  let from = 0;
  let star = -1;
  let resume = 0;

  while (from < text.length) {
    const wanted = pattern[at];

    if (wanted === "?" || (wanted !== "*" && wanted === text[from])) {
      at += 1;
      from += 1;
    } else if (wanted === "*") {
      star = at;
      resume = from;
      at += 1;
    } else if (star === -1) {
      return false;
    } else {
      at = star + 1;
      resume += 1;
      from = resume;
    }
  }

  while (pattern[at] === "*") {
    at += 1;
  }

  return at === pattern.length;
};

const matchSegments = (
  globs: readonly string[],
  parts: readonly string[]
): boolean => {
  const [glob, ...restGlobs] = globs;

  if (glob === undefined) {
    return parts.length === 0;
  }

  if (glob === "**") {
    return [...parts.keys(), parts.length].some((skip) =>
      matchSegments(restGlobs, parts.slice(skip))
    );
  }

  const [part, ...restParts] = parts;

  return (
    part !== undefined &&
    matchSegment(glob, part) &&
    matchSegments(restGlobs, restParts)
  );
};

/**
 * Whether a repo path matches a glob: `**` as a whole segment is any number
 * of directories (none included), `*` is any run of characters within a
 * segment and `?` one character. A leading dot is matched like any other
 * character, so `*` reaches dotfiles. No braces, no classes, no negation.
 * Pure and dependency-free, so the gate can copy it.
 */
export const matchGlob = (glob: string, path: string): boolean =>
  matchSegments(
    withoutDotSlash(glob).split("/"),
    withoutDotSlash(path).split("/")
  );

/**
 * Whether an answer that changes `path` changes the judge: some closure glob
 * matches it and no `!` glob takes it back out. A JSON pointer never judges a
 * whole file (`package.json` stays editable); `touchedPointers` reads those.
 */
export const isJudged = (closure: Policy["judge"], path: string): boolean => {
  const excluded = closure.paths.some(
    (glob) =>
      glob.startsWith(EXCLUDE) && matchGlob(glob.slice(EXCLUDE.length), path)
  );

  return (
    !excluded &&
    closure.paths.some(
      (glob) => !glob.startsWith(EXCLUDE) && matchGlob(glob, path)
    )
  );
};

const decodeJson = Schema.decodeOption(Schema.fromJsonString(Schema.Json));

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value) && !isJsonArray(value);

// The index just past the string literal whose quote is at `at`; an
// unclosed string runs to the end.
const stringEnd = (text: string, at: number): number => {
  const quote = text.charAt(at);
  let next = at + 1;

  while (next < text.length && text.charAt(next) !== quote) {
    next += text.charAt(next) === "\\" ? 2 : 1;
  }

  return Math.min(next + 1, text.length);
};

/** Where the comment that opens at `at` ends, if one opens there. */
type CommentEnd = (text: string, at: number) => Option.Option<number>;

// The index just past the comment that opens at `at`, if one does.
const commentEnd: CommentEnd = (text, at) => {
  if (text.startsWith("//", at)) {
    const end = text.indexOf("\n", at);

    return Option.some(end === -1 ? text.length : end);
  }

  if (text.startsWith("/*", at)) {
    const end = text.indexOf("*/", at + 2);

    return Option.some(end === -1 ? text.length : end + 2);
  }

  return Option.none();
};

// The index just past the `#` comment (TOML's) that opens at `at`, if one does.
const hashCommentEnd: CommentEnd = (text, at) => {
  if (text.charAt(at) !== "#") {
    return Option.none();
  }

  const end = text.indexOf("\n", at);

  return Option.some(end === -1 ? text.length : end);
};

const QUOTES = new Set(['"', "'", "`"]);

/**
 * Text with each comment outside a string as one space: `//` and `/* *\/`
 * ones by default (JavaScript, JSONC), or those `opens` finds.
 */
const withoutComments = (
  text: string,
  opens: CommentEnd = commentEnd
): string => {
  let kept = "";
  let at = 0;

  while (at < text.length) {
    const char = text.charAt(at);

    if (QUOTES.has(char)) {
      const end = stringEnd(text, at);

      kept += text.slice(at, end);
      at = end;
    } else {
      const end = opens(text, at);

      kept += Option.isSome(end) ? " " : char;
      at = Option.isSome(end) ? end.value : at + 1;
    }
  }

  return kept;
};

const isSpace = (char: string) => /\s/u.test(char);

// Whether the next character after `at` that isn't space closes a bracket.
const closesNext = (text: string, at: number) => {
  let peek = at;

  while (isSpace(text.charAt(peek))) {
    peek += 1;
  }

  return peek < text.length && "]}".includes(text.charAt(peek));
};

/** JSON text with each comma that closes nothing (`[1, 2,]`) left out. */
const withoutTrailingCommas = (text: string): string => {
  let kept = "";
  let at = 0;

  while (at < text.length) {
    const char = text.charAt(at);
    const end = char === '"' ? stringEnd(text, at) : at + 1;

    kept += char === "," && closesNext(text, end) ? "" : text.slice(at, end);
    at = end;
  }

  return kept;
};

/**
 * JSONC (tsconfig, `.oxlintrc.json`, harness settings) read as JSON: its
 * comments and trailing commas are dropped first. Pure and dependency-free.
 */
const decodeJsonc = (text: string): Option.Option<Schema.Json> =>
  decodeJson(withoutTrailingCommas(withoutComments(text)));

const UNREADABLE =
  "not JSON, even with comments and trailing commas removed; the walk stops here";

const UNREAD = "not among the files read; judged unread";

const dirname = (path: string) => path.split("/").slice(0, -1).join("/");

// `a/b` joined with `../c` is `c`; `..` above the root leaves the repo.
const join = (dir: string, relative: string): Option.Option<string> => {
  const parts: string[] = dir === "" ? [] : dir.split("/");

  for (const part of relative.split("/")) {
    if (part === "..") {
      if (parts.pop() === undefined) {
        return Option.none();
      }
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return parts.length === 0 ? Option.none() : Option.some(parts.join("/"));
};

const isRelative = (specifier: string) =>
  specifier === "." ||
  specifier === ".." ||
  specifier.startsWith("./") ||
  specifier.startsWith("../");

const isPackageJson = (path: string) => matchGlob("**/package.json", path);

/** Each workspace package's name and folder, from the manifests given. */
const workspacesOf = (
  contents: ReadonlyMap<string, string>
): ReadonlyMap<string, string> =>
  new Map(
    [...contents]
      .filter(([path]) => isPackageJson(path))
      .flatMap(([path, content]) =>
        decodeJson(content).pipe(
          Option.filter(isJsonObject),
          Option.flatMapNullishOr((manifest) => manifest.name),
          Option.filter(Predicate.isString),
          Option.filter((name) => name.length > 0),
          Option.match({
            onNone: () => [],
            onSome: (name) => [[name, dirname(path)] as const],
          })
        )
      )
  );

/**
 * A package specifier read as a workspace package's own file: `@repo/x/y`
 * is `y` inside the folder of the package named `@repo/x`, the longest name
 * winning. A package no workspace declares is a dependency, not a path.
 */
const inWorkspace = (
  specifier: string,
  workspaces: ReadonlyMap<string, string>
): Option.Option<{ readonly dir: string; readonly rest: string }> =>
  Option.fromNullishOr(
    [...workspaces]
      .filter(
        ([name]) => specifier === name || specifier.startsWith(`${name}/`)
      )
      .toSorted(([left], [right]) => right.length - left.length)
      .map(([name, dir]) => ({ dir, rest: specifier.slice(name.length + 1) }))
      .at(0)
  );

// `./base` names `base.json` when only that exists, as TypeScript resolves
// it; a target not among the files keeps the name tsc would read.
const configFile = (path: string, contents: ReadonlyMap<string, string>) =>
  [path, `${path}.json`].find((candidate) => contents.has(candidate)) ??
  (path.endsWith(".json") ? path : `${path}.json`);

/**
 * Where a tsconfig's `extends` entry points: a relative path from the file's
 * folder, or a file of a workspace package (a bare package name is its
 * `tsconfig.json`). Any other package (`@tsconfig/node24`) is a dependency.
 */
const resolveExtends = (
  from: string,
  specifier: string,
  contents: ReadonlyMap<string, string>,
  workspaces: ReadonlyMap<string, string>
): Option.Option<string> => {
  if (isRelative(specifier)) {
    return Option.map(join(dirname(from), specifier), (path) =>
      configFile(path, contents)
    );
  }

  return Option.flatMap(inWorkspace(specifier, workspaces), ({ dir, rest }) =>
    Option.map(join(dir, rest === "" ? "tsconfig.json" : rest), (path) =>
      configFile(path, contents)
    )
  );
};

const extendsOf = (config: Schema.Json): readonly string[] => {
  const value = isJsonObject(config) ? config.extends : undefined;

  return [value ?? []].flat().filter(Predicate.isString);
};

/** A path the walk could not read past, and why. */
const note = (path: string, reason: string) => `${path}: ${reason}`;

const chainFrom = (
  start: string,
  contents: ReadonlyMap<string, string>,
  workspaces: ReadonlyMap<string, string>
) => {
  const chain = [start];
  const notes: string[] = [];

  for (const next of chain) {
    const content = contents.get(next);
    const config = Option.flatMap(Option.fromNullishOr(content), decodeJsonc);

    if (content === undefined) {
      notes.push(note(next, UNREAD));
    } else if (Option.isNone(config)) {
      notes.push(note(next, UNREADABLE));
    }

    const parents = Option.match(config, {
      onNone: () => [],
      onSome: extendsOf,
    }).flatMap((specifier) =>
      Option.toArray(resolveExtends(next, specifier, contents, workspaces))
    );

    chain.push(...parents.filter((parent) => !chain.includes(parent)));
  }

  return { chain: chain.map((path) => RepoPath.make(path)), notes };
};

/**
 * A tsconfig and every file its `extends` reaches, in the order tsc reads
 * them: string and array forms, relative paths (`.json` added as tsc adds
 * it) and workspace packages' files. Files are read as JSONC. A file that
 * still doesn't parse ends its branch and stays in the chain, as does a
 * target not among `files`; each says why in `notes`.
 */
export const tsconfigChain = (
  start: RepoPath,
  files: ReadonlyMap<string, string>
): {
  readonly chain: readonly RepoPath[];
  readonly notes: readonly string[];
} => chainFrom(start, files, workspacesOf(files));

/** A token of JavaScript or JSON text, its comments dropped. */
interface Token {
  readonly kind: "mark" | "string" | "word";
  readonly text: string;
}

const isWordChar = (char: string) => /[\w$]/u.test(char);

// A string literal's value; a template with `${…}` in it is no one value.
const literal = (quote: string, body: string): Token =>
  quote === "`" && body.includes("${")
    ? { kind: "mark", text: quote }
    : { kind: "string", text: body.replaceAll(/\\(?<char>.)/gu, "$<char>") };

/**
 * Source text as words, string literals and single marks, comments
 * dropped (JavaScript's by default; TOML passes its `#`). Enough to read
 * imports and literal arrays without running the file; a regex literal that
 * holds a quote can mislead it.
 */
const tokensOf = (
  source: string,
  comments: CommentEnd = commentEnd
): readonly Token[] => {
  const text = withoutComments(source, comments);
  const tokens: Token[] = [];
  let at = 0;

  while (at < text.length) {
    const char = text.charAt(at);
    let end = at + 1;

    if (QUOTES.has(char)) {
      end = stringEnd(text, at);
      tokens.push(literal(char, text.slice(at + 1, end - 1)));
    } else if (isWordChar(char)) {
      while (end < text.length && isWordChar(text.charAt(end))) {
        end += 1;
      }

      tokens.push({ kind: "word", text: text.slice(at, end) });
    } else if (!isSpace(char)) {
      tokens.push({ kind: "mark", text: char });
    }

    at = end;
  }

  return tokens;
};

// Words a module path follows as a call's first argument: `import("…")`,
// `require("…")`, `require.resolve("…")`, `new URL("…", import.meta.url)`.
const LOADERS = new Set(["URL", "import", "require", "resolve"]);

/** The module specifiers source text imports, exports from or requires. */
const importSpecifiers = (tokens: readonly Token[]): readonly string[] =>
  tokens.flatMap((token, at) => {
    const next = tokens[at + 1];
    const after = tokens[at + 2];

    if (token.kind !== "word" || next === undefined) {
      return [];
    }

    if (
      (token.text === "from" || token.text === "import") &&
      next.kind === "string"
    ) {
      return [next.text];
    }

    return LOADERS.has(token.text) &&
      next.text === "(" &&
      after?.kind === "string"
      ? [after.text]
      : [];
  });

// Marks that open and close a nesting level in source text.
const OPENS = new Set(["(", "[", "{"]);

const CLOSES = new Set([")", "]", "}"]);

/** What a `jsPlugins` key in source text holds, as far as its text says. */
interface PluginList {
  /** Each plugin string in a literal array, or an object's `specifier:` string. */
  readonly specifiers: readonly string[];
  /** Whether some `jsPlugins` holds something other than a literal array. */
  readonly opaque: boolean;
}

// The strings of one `jsPlugins: [...]` array that starts at token `at`.
const listedAt = (tokens: readonly Token[], at: number): readonly string[] => {
  const found: string[] = [];
  let depth = 0;

  for (let index = at; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token?.kind === "mark" && OPENS.has(token.text)) {
      depth += 1;
    } else if (token?.kind === "mark" && CLOSES.has(token.text)) {
      depth -= 1;

      if (depth === 0) {
        return found;
      }
    } else if (
      token?.kind === "string" &&
      (depth === 1 ||
        (tokens[index - 2]?.text === "specifier" &&
          tokens[index - 1]?.text === ":"))
    ) {
      found.push(token.text);
    }
  }

  return found;
};

/**
 * The `jsPlugins` arrays of an oxlint config's source, read as text: a key's
 * (`jsPlugins: [...]`) or a variable's (`const jsPlugins = [...]`).
 */
const jsPluginsInSource = (tokens: readonly Token[]): PluginList => {
  const starts = tokens.flatMap((token, at) =>
    token.text === "jsPlugins" &&
    (tokens[at + 1]?.text === ":" || tokens[at + 1]?.text === "=")
      ? [at + 2]
      : []
  );

  return {
    opaque: starts.some((at) => tokens[at]?.text !== "["),
    specifiers: starts
      .filter((at) => tokens[at]?.text === "[")
      .flatMap((at) => listedAt(tokens, at)),
  };
};

/** The `jsPlugins` of a JSON oxlint config: strings, or `{specifier}` objects. */
const jsPluginsInJson = (config: Schema.Json): readonly string[] => {
  const list = isJsonObject(config) ? config.jsPlugins : undefined;

  return (list !== undefined && isJsonArray(list) ? list : []).flatMap(
    (entry) => {
      if (Predicate.isString(entry)) {
        return [entry];
      }

      const specifier = isJsonObject(entry) ? entry.specifier : undefined;

      return Predicate.isString(specifier) ? [specifier] : [];
    }
  );
};

const basename = (path: string) => path.split("/").at(-1) ?? path;

// `.oxlintrc.json`, `.oxlintrc`, `.eslintrc.json`: configs written as JSONC.
const isJsonConfig = (path: string) =>
  /\.jsonc?$/u.test(path) || basename(path) === ".oxlintrc";

/** The lint configs whose plugins and imports judge: oxlint's and eslint's. */
const lintConfigGlobs = [
  "**/oxlint.config.*",
  "**/oxlint.*.config.*",
  "**/.oxlintrc*",
  "**/eslint.config.*",
  "**/eslint.*.config.*",
  "**/.eslintrc*",
];

const isLintConfig = (path: string) =>
  lintConfigGlobs.some((glob) => matchGlob(glob, path));

/** What one lint config names: its plugins, and the modules it imports or extends. */
interface LintNames {
  readonly imports: readonly string[];
  readonly notes: readonly string[];
  readonly plugins: readonly string[];
}

const lintNames = (config: RepoFile): LintNames => {
  if (isJsonConfig(config.path)) {
    return Option.match(decodeJsonc(config.content), {
      onNone: () => ({
        imports: [],
        notes: [note(config.path, UNREADABLE)],
        plugins: [],
      }),
      onSome: (json) => ({
        imports: extendsOf(json),
        notes: [],
        plugins: jsPluginsInJson(json),
      }),
    });
  }

  const tokens = tokensOf(config.content);
  const plugins = jsPluginsInSource(tokens);

  return {
    imports: importSpecifiers(tokens),
    notes: plugins.opaque
      ? [
          note(
            config.path,
            "jsPlugins is not a literal array; its plugins are unknown"
          ),
        ]
      : [],
    plugins: plugins.specifiers,
  };
};

// Relative specifiers, as paths from the repo root.
const relativeFrom = (
  from: string,
  specifiers: readonly string[]
): readonly RepoPath[] =>
  specifiers
    .filter(isRelative)
    .flatMap((specifier) => Option.toArray(join(dirname(from), specifier)))
    .map((path) => RepoPath.make(path));

/**
 * The local plugins an oxlint config loads, as repo paths: each `jsPlugins`
 * entry of a `.oxlintrc*.json` (a string or `{specifier}`), or each string in
 * an `oxlint.config.*`'s `jsPlugins` array, read as text and never run.
 * Relative to the config's folder; a package name (`eslint-plugin-foo`) is a
 * dependency, not a path. A config that doesn't parse names none.
 */
export const jsPluginSpecifiers = (config: RepoFile): readonly RepoPath[] =>
  relativeFrom(config.path, lintNames(config).plugins);

/**
 * The local modules an eslint config imports or requires (plugins and shared
 * configs alike), as repo paths from the config's folder, read as text and
 * never run. Packages are dependencies, not paths.
 */
export const eslintLocalPlugins = (config: RepoFile): readonly RepoPath[] =>
  relativeFrom(config.path, lintNames(config).imports);

const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

const isIndex = (path: string) => /^index\.[cm]?[jt]sx?$/u.test(basename(path));

const hasExtension = (path: string) => /\.[^./]+$/u.test(basename(path));

const TWINS = new Map([
  [".cjs", [".cts"]],
  [".js", [".ts", ".tsx"]],
  [".mjs", [".mts"]],
]);

// TypeScript's ESM habit: `./x.js` names `x.ts` when only that exists.
const sourceTwins = (path: string): readonly string[] => {
  const dot = path.lastIndexOf(".");
  const stem = path.slice(0, dot);

  return (TWINS.get(path.slice(dot)) ?? []).map((ext) => `${stem}${ext}`);
};

/**
 * What a module path turns out to be among the repo's files: a file (an
 * `index.*` brings its whole folder), a folder (`./rules` with
 * `rules/index.js`), or, when it is neither, the path, its extensions and
 * its folder, so a file an answer adds there is judged too.
 */
interface Settled {
  /** The plugin's own path: its file, or its folder for a folder plugin. */
  readonly anchor: string;
  /** The file to read next, when one exists. */
  readonly file: Option.Option<string>;
  readonly globs: readonly string[];
}

const settledFile = (file: string): Settled => {
  const folder = dirname(file);

  return isIndex(file) && folder !== ""
    ? { anchor: folder, file: Option.some(file), globs: [`${folder}/**`] }
    : { anchor: file, file: Option.some(file), globs: [file] };
};

const settle = (path: string, paths: ReadonlySet<string>): Settled => {
  const found = [
    path,
    ...MODULE_EXTENSIONS.map((ext) => `${path}${ext}`),
    ...sourceTwins(path),
  ].find((candidate) => paths.has(candidate));

  if (found !== undefined) {
    return settledFile(found);
  }

  const index = MODULE_EXTENSIONS.map((ext) => `${path}/index${ext}`).find(
    (candidate) => paths.has(candidate)
  );

  const folder = `${path}/`;

  if (
    index !== undefined ||
    [...paths].some((candidate) => candidate.startsWith(folder))
  ) {
    return {
      anchor: path,
      file: Option.fromNullishOr(index),
      globs: [`${path}/**`],
    };
  }

  return hasExtension(path)
    ? settledFile(path)
    : {
        anchor: path,
        file: Option.none(),
        globs: [path, `${path}.*`, `${path}/**`],
      };
};

// A command's words that could name a file: split on whitespace and shell
// operators, quotes dropped, a leading `$VAR/` or `${VAR}/` dropped (the
// project folder a harness exports), a `--flag=value`'s value, and a path
// after `$(…)` read from the root.
const wordsOf = (command: string): readonly string[] =>
  command
    .split(/[\s;&|()<>`]+/u)
    .map((word) =>
      word.replaceAll(/["']/gu, "").replace(/^\$(?:\{\w+\}|\w+)\//u, "")
    )
    .flatMap((word) => [word, word.slice(word.indexOf("=") + 1)])
    .flatMap((word) => [word, word.replace(/^\/+/u, "")])
    .map(withoutDotSlash);

/**
 * Manifests, lockfiles and dependency lists. A command may name one (`pip
 * install -r requirements.txt`), and it stays editable all the same:
 * dependency edits are allowed, as they are in `package.json`, whose scripts
 * alone judge, by pointer.
 */
const dependencyFileGlobs = [
  "**/package.json",
  "**/bun.lock",
  "**/bun.lockb",
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/requirements*.txt",
  "**/constraints*.txt",
  "**/poetry.lock",
  "**/uv.lock",
  "**/Pipfile.lock",
  "**/Cargo.lock",
  "**/go.sum",
  "**/Gemfile.lock",
  "**/composer.lock",
];

const isDependencyFile = (path: string) =>
  dependencyFileGlobs.some((glob) => matchGlob(glob, path));

/**
 * The tracked files commands run or read, from the words that name one:
 * `bun "${CLAUDE_PROJECT_DIR}/scripts/hooks/x.ts"` → `scripts/hooks/x.ts`.
 * A manifest, lockfile or dependency list is never one (dependency edits stay
 * allowed). Sorted.
 */
export const commandScripts = (
  commands: readonly string[],
  files: ReadonlySet<string>
): readonly RepoPath[] =>
  [
    ...new Set(
      commands
        .flatMap(wordsOf)
        .filter((word) => files.has(word) && !isDependencyFile(word))
    ),
  ]
    .toSorted()
    .map((path) => RepoPath.make(path));

const isShell = (path: string) =>
  /\.(?:ba|z)?sh$/u.test(path) || !hasExtension(path);

const CODE = /\.[cm]?[jt]sx?$/u;

// What one file runs, as repo paths: a code file's relative imports and
// `jsPlugins` strings, or the tracked files a shell script's lines name.
const runsFrom = (
  path: string,
  content: string,
  paths: ReadonlySet<string>
): readonly string[] => {
  if (CODE.test(path)) {
    const tokens = tokensOf(content);

    return relativeFrom(path, [
      ...importSpecifiers(tokens),
      ...jsPluginsInSource(tokens).specifiers,
    ]);
  }

  return isShell(path) ? commandScripts(content.split("\n"), paths) : [];
};

/**
 * Every module the seeds reach by relative imports, and every script a
 * shell script among them runs, settled to globs: what a lint plugin, a hook
 * script or a check script runs is judged with it. Packages, workspace ones
 * included, are not followed, nor any path `follows` refuses. A file without
 * contents ends its branch.
 */
const walkImports = (
  seeds: readonly string[],
  contents: ReadonlyMap<string, string>,
  paths: ReadonlySet<string>,
  follows: (path: string) => boolean = () => true
): readonly string[] => {
  const queue = [...seeds];
  const globs: string[] = [];

  for (const path of queue) {
    const content = contents.get(path);

    if (content !== undefined) {
      const targets = runsFrom(path, content, paths)
        .filter(follows)
        .map((target) => settle(target, paths));

      globs.push(...targets.flatMap((target) => target.globs));
      queue.push(
        ...targets
          .flatMap((target) => Option.toArray(target.file))
          .filter((file) => !queue.includes(file))
      );
    }
  }

  return globs;
};

/** The lint sources a repo's lint configs name, and where they stand. */
interface LintSources {
  /** Each plugin's own path, for its rule fixtures. */
  readonly anchors: readonly string[];
  readonly globs: readonly string[];
  readonly notes: readonly string[];
}

/**
 * Every lint config's plugins and imports, settled: relative paths, and
 * workspace packages by their folders (a package a lint config names is
 * lint source too). Then what those modules import, relatively.
 */
const lintSources = (
  contents: ReadonlyMap<string, string>,
  paths: ReadonlySet<string>,
  workspaces: ReadonlyMap<string, string>
): LintSources => {
  const configs = [...paths].filter(isLintConfig).toSorted();

  const named = configs.map((path) => {
    const names = lintNames({ content: contents.get(path) ?? "", path });

    const targets = [...names.plugins, ...names.imports].flatMap((specifier) =>
      isRelative(specifier)
        ? Option.toArray(join(dirname(path), specifier))
        : Option.toArray(
            Option.flatMap(
              inWorkspace(specifier, workspaces),
              ({ dir, rest }) => join(dir, rest)
            )
          )
    );

    return {
      notes: names.notes,
      settled: targets.map((target) => settle(target, paths)),
    };
  });

  const settled = named.flatMap((config) => config.settled);
  const files = settled.flatMap((target) => Option.toArray(target.file));

  return {
    anchors: settled.map((target) => target.anchor),
    globs: [
      ...settled.flatMap((target) => target.globs),
      ...walkImports(files, contents, paths),
    ],
    notes: named.flatMap((config) => config.notes),
  };
};

// A whole folder (`a/b/**`) the closure holds makes any other glob or path
// under it redundant.
const withoutCovered = (globs: readonly string[]): readonly string[] => {
  const folders = globs.flatMap((glob) =>
    glob.endsWith("/**") && !glob.slice(0, -3).includes("*")
      ? [glob.slice(0, -2)]
      : []
  );

  return globs.filter(
    (glob) =>
      !folders.some(
        (folder) => glob !== `${folder}**` && glob.startsWith(folder)
      )
  );
};

const FIXTURE_FOLDERS = ["__fixtures__", "test", "tests"];

const TEST_FILE =
  /(?:^|\/)(?:__fixtures__|__tests__|tests?)\/|\.(?:spec|test)\.[cm]?[jt]sx?$/u;

// A path without its file's extension: `lint/plugin.mjs` is `lint/plugin`.
const stemOf = (path: string) =>
  hasExtension(path) ? path.slice(0, path.lastIndexOf(".")) : path;

/** A plugin as a test can name it: its folder, or its file with or without extension. */
interface PluginName {
  readonly folder: boolean;
  readonly path: string;
}

const namesPlugin = (candidate: string, plugin: PluginName) =>
  plugin.folder
    ? candidate === plugin.path || candidate.startsWith(`${plugin.path}/`)
    : stemOf(candidate) === stemOf(plugin.path);

// The paths a string in a test at `from` can mean: relative to the test,
// and, for `./x` or a bare path, from the repo root (a config written inline).
const readingsOf = (from: string, text: string): readonly string[] => {
  if (text.startsWith("../")) {
    return Option.toArray(join(dirname(from), text));
  }

  const rooted = withoutDotSlash(text);

  return text.startsWith("./")
    ? [...Option.toArray(join(dirname(from), text)), rooted]
    : [rooted];
};

/**
 * The rule fixture tests of local lint plugins: the `test/`, `tests/` and
 * `__fixtures__/` folders beside each plugin (beside a plugin file, or beside
 * a plugin's folder; never at the repo root, where they hold the project's
 * own tests), any `*-rule.test.*`, and every test file whose text names a
 * plugin's path, by import or as a string from the root. Plugins are given
 * as their entry files (an `index.*` stands for its folder) or folders.
 */
export const ruleFixtures = (
  pluginPaths: readonly string[],
  files: readonly string[],
  contents: ReadonlyMap<string, string>
): readonly Glob[] => {
  const plugins = pluginPaths.map((plugin): PluginName =>
    isIndex(plugin)
      ? { folder: true, path: dirname(plugin) }
      : {
          folder: files.some((path) => path.startsWith(`${plugin}/`)),
          path: plugin,
        }
  );

  // A plugin's folder sits beside its fixtures as a plugin file does.
  const beside = plugins.flatMap((plugin) => {
    const folder = dirname(plugin.path);

    return folder === ""
      ? []
      : FIXTURE_FOLDERS.map((name) => `${folder}/${name}/**`);
  });

  // Cheap first: a test that never spells a plugin's last name can't name it.
  const lastNames = plugins.map((plugin) => basename(stemOf(plugin.path)));

  const naming = files.filter((path) => {
    const content = contents.get(path) ?? "";

    return (
      TEST_FILE.test(path) &&
      lastNames.some((name) => content.includes(name)) &&
      tokensOf(content).some(
        (token) =>
          token.kind === "string" &&
          readingsOf(path, token.text).some((reading) =>
            plugins.some((plugin) => namesPlugin(reading, plugin))
          )
      )
    );
  });

  const named =
    plugins.length === 0 ? [] : ["**/*-rule.spec.*", "**/*-rule.test.*"];

  return withoutCovered([...new Set([...beside, ...named, ...naming])])
    .toSorted()
    .map((glob) => Glob.make(glob));
};

// Keys whose strings a hook manager runs: Claude Code, Cursor, Codex and
// Gemini's `command` (with `args`), Copilot's `bash` and `powershell`,
// lefthook's `run` and `script`, pre-commit's `entry`.
const COMMAND_KEYS = new Set([
  "args",
  "bash",
  "command",
  "commands",
  "entry",
  "powershell",
  "run",
  "script",
]);

// Every string under a command key, at any depth of a JSON or YAML value.
const commandsIn = (
  value: Schema.Json,
  underKey: boolean
): readonly string[] => {
  if (Predicate.isString(value)) {
    return underKey ? [value] : [];
  }

  if (isJsonArray(value)) {
    return value.flatMap((item) => commandsIn(item, underKey));
  }

  return isJsonObject(value)
    ? Object.entries(value).flatMap(([key, item]) =>
        commandsIn(item, COMMAND_KEYS.has(key))
      )
    : [];
};

const decodeAnyJson = Schema.decodeUnknownOption(Schema.Json);

// YAML that `yaml` can't parse, or that holds a value JSON can't, is None.
const decodeYaml = (text: string): Option.Option<Schema.Json> =>
  Option.flatten(
    Option.liftThrowable((source: string) =>
      decodeAnyJson(parse(source, { logLevel: "error", strict: false }))
    )(text)
  );

/** What one hook config runs, as command lines, and why it could not be read. */
interface HookCommands {
  readonly commands: readonly string[];
  readonly notes: readonly string[];
}

const unreadable = (path: string, reason: string): HookCommands => ({
  commands: [],
  notes: [note(path, reason)],
});

/**
 * The commands a hook config runs: the strings under command keys of a JSON
 * (JSONC) or YAML config, the strings of a TOML config or a code plugin, and
 * every line of a shell hook. Other files (a README) run nothing.
 */
const hookCommands = (hook: RepoFile): HookCommands => {
  const { content, path } = hook;

  if (/\.jsonc?$/u.test(path)) {
    return Option.match(decodeJsonc(content), {
      onNone: () => unreadable(path, UNREADABLE),
      onSome: (json) => ({ commands: commandsIn(json, false), notes: [] }),
    });
  }

  if (/\.ya?ml$/u.test(path)) {
    return Option.match(decodeYaml(content), {
      onNone: () => unreadable(path, "not YAML; the walk stops here"),
      onSome: (yaml) => ({ commands: commandsIn(yaml, false), notes: [] }),
    });
  }

  if (CODE.test(path) || path.endsWith(".toml")) {
    return {
      commands: tokensOf(
        content,
        path.endsWith(".toml") ? hashCommentEnd : commentEnd
      )
        .filter((token) => token.kind === "string")
        .map((token) => token.text),
      notes: [],
    };
  }

  return { commands: isShell(path) ? content.split("\n") : [], notes: [] };
};

/**
 * The hook configs among the files, the scripts their commands name, and
 * what those scripts and code plugins (pi, OpenCode, Amp) import.
 */
const hookSources = (
  contents: ReadonlyMap<string, string>,
  paths: ReadonlySet<string>,
  sorted: readonly string[]
) => {
  const configs = sorted.filter((path) =>
    hookConfigGlobs.some((glob) => matchGlob(glob, path))
  );

  const read = configs.map((path) =>
    hookCommands({ content: contents.get(path) ?? "", path })
  );

  const scripts = commandScripts(
    read.flatMap((hook) => hook.commands),
    paths
  );

  const code = configs.filter((path) => CODE.test(path));

  return {
    globs: [...scripts, ...walkImports([...scripts, ...code], contents, paths)],
    notes: read.flatMap((hook) => hook.notes),
  };
};

const SCRIPTS = "#/scripts";

/**
 * A judge closure as data, the shape `Policy.judge` stores: globs (a `!` glob
 * takes paths back out), and `<file>#<JSON pointer>` parts of files.
 */
export interface JudgeClosure {
  readonly paths: readonly Glob[];
  readonly pointers: readonly string[];
  /** Where the walk stopped early (a file that isn't JSONC, one not read), and why. */
  readonly notes?: readonly string[];
}

/**
 * What the scripts run commands name import and run in turn, inside each
 * script's own folder only: a check script's helpers sit beside it, while
 * what it imports from elsewhere is the product it checks, which an answer
 * must stay free to change. A script at the root follows nothing.
 */
const checkScripts = (
  scripts: readonly string[],
  contents: ReadonlyMap<string, string>,
  paths: ReadonlySet<string>
): readonly string[] =>
  scripts.flatMap((script) => {
    const folder = dirname(script);

    return folder === ""
      ? []
      : walkImports([script], contents, paths, (path) =>
          path.startsWith(`${folder}/`)
        );
  });

/**
 * The judge closure for a run block over a repo's files: the defaults (the
 * policy files and every hook config among them); every file a run command
 * names (`./test.sh` → `test.sh`) and what it imports or runs from its own
 * folder; every script a hook command names, with all it imports or runs;
 * each tsconfig's `extends` chain; every lint plugin and module a lint config
 * loads, with what it imports and its rule fixture tests; and each
 * `package.json`'s scripts as a pointer. Manifests, lockfiles and dependency
 * lists stay editable. Files are read as text, never run; one that doesn't
 * parse is still judged, and `notes` says where the walk stopped. Its shape
 * is `@repo/rules`' `Finishers.judgeClosure`, so the platform passes it in.
 */
export const judgeClosure = (
  run: RunBlock,
  files: readonly RepoFile[]
): JudgeClosure => {
  const contents = new Map(
    files.map((file) => [withoutDotSlash(file.path), file.content])
  );

  const paths = new Set(contents.keys());
  const sorted = [...paths].toSorted();
  const workspaces = workspacesOf(contents);

  const commands = [
    run.setup,
    run.doctor,
    run.test,
    ...Object.values(run.checks),
  ].filter(Predicate.isNotUndefined);

  const named = commandScripts(commands, paths);

  const chains = sorted.flatMap((path) =>
    matchGlob("**/tsconfig*.json", path)
      ? [chainFrom(path, contents, workspaces)]
      : []
  );

  const lint = lintSources(contents, paths, workspaces);
  const hooks = hookSources(contents, paths, sorted);

  const derived = [
    ...named,
    ...checkScripts(named, contents, paths),
    ...hooks.globs,
    ...chains.flatMap(({ chain }) => chain.slice(1)),
    ...lint.globs,
    ...ruleFixtures(lint.anchors, sorted, contents),
  ];

  const defaults = new Set<string>(defaultJudgeGlobs);

  const added = withoutCovered([...new Set(derived)])
    .filter((path) => !defaults.has(path) && !isDependencyFile(path))
    .toSorted()
    .map((path) => Glob.make(path));

  const packages = sorted.filter(isPackageJson);

  const pointers = [
    ...packages.filter((path) => path === "package.json"),
    ...packages.filter((path) => path !== "package.json"),
  ].map((path) => `${path}${SCRIPTS}`);

  const notes = [
    ...new Set([
      ...chains.flatMap((walk) => walk.notes),
      ...lint.notes,
      ...hooks.notes,
    ]),
  ].toSorted();

  const closure = { paths: [...defaultJudgeGlobs, ...added], pointers };

  return notes.length === 0 ? closure : { ...closure, notes };
};

// RFC 6901: `/a~1b` is the key `a/b`; `~0` is `~`.
const pointerTokens = (pointer: string): readonly string[] =>
  pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));

// One step down a JSON value: an object's own key, or an array's index.
const childAt = (
  value: Schema.Json,
  token: string
): Option.Option<Schema.Json> => {
  if (isJsonArray(value)) {
    return /^(?:0|[1-9]\d*)$/u.test(token)
      ? Option.fromNullishOr(value[Number(token)])
      : Option.none();
  }

  return isJsonObject(value) && Object.hasOwn(value, token)
    ? Option.fromNullishOr(value[token])
    : Option.none();
};

const valueAt = (
  json: Schema.Json,
  tokens: readonly string[]
): Option.Option<Schema.Json> => {
  let value = Option.some(json);

  for (const token of tokens) {
    value = Option.flatMap(value, (current) => childAt(current, token));
  }

  return value;
};

// What one side of a change holds at a pointer: nothing (no file, or no such
// key), the value, or the text of a file that isn't JSON.
const read = (
  file: RepoFile | undefined,
  target: string,
  tokens: readonly string[]
): Option.Option<Result.Result<Schema.Json, string>> =>
  file === undefined || !matchGlob(target, file.path)
    ? Option.none()
    : Option.match(decodeJson(file.content), {
        onNone: () => Option.some(Result.fail(file.content)),
        onSome: (json) => Option.map(valueAt(json, tokens), Result.succeed),
      });

/**
 * The closure's pointers whose value differs between a file's two versions:
 * `["package.json#/scripts"]` when a script changed, `[]` for a dependency
 * edit. Values compare as JSON, so moving a key or reformatting is no change.
 * A file added (no `before`), deleted (no `after`), or no longer valid JSON
 * counts as a change.
 */
export const touchedPointers = (
  closure: Policy["judge"],
  before: RepoFile | undefined,
  after?: RepoFile
): readonly string[] =>
  closure.pointers.filter((pointer) => {
    const hash = pointer.indexOf("#");
    const target = hash === -1 ? pointer : pointer.slice(0, hash);
    const tokens = pointerTokens(hash === -1 ? "" : pointer.slice(hash + 1));

    return !Equal.equals(
      read(before, target, tokens),
      read(after, target, tokens)
    );
  });
