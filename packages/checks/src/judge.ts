import { Brand } from "@repo/brand";
import { Glob } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import type { RunBlock } from "@repo/protocol/domain/run";
import { RepoPath } from "@repo/protocol/ids";
import { Effect, Equal, Option, Predicate, Result, Schema } from "effect";
import { parse } from "yaml";

import { findRunBlock } from "./finder.ts";
import type { RepoFile } from "./finder.ts";

const EXCLUDE = "!";

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

// A leading dot is matched like any other character, so `*` reaches dotfiles.
export const matchGlob = (glob: string, path: string): boolean =>
  matchSegments(
    withoutDotSlash(glob).split("/"),
    withoutDotSlash(path).split("/")
  );

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

const stringEnd = (text: string, at: number): number => {
  const quote = text.charAt(at);
  let next = at + 1;

  while (next < text.length && text.charAt(next) !== quote) {
    next += text.charAt(next) === "\\" ? 2 : 1;
  }

  return Math.min(next + 1, text.length);
};

type CommentEnd = (text: string, at: number) => Option.Option<number>;

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

const hashCommentEnd: CommentEnd = (text, at) => {
  if (text.charAt(at) !== "#") {
    return Option.none();
  }

  const end = text.indexOf("\n", at);

  return Option.some(end === -1 ? text.length : end);
};

const QUOTES = new Set(['"', "'", "`"]);

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

const closesNext = (text: string, at: number) => {
  let peek = at;

  while (isSpace(text.charAt(peek))) {
    peek += 1;
  }

  return peek < text.length && "]}".includes(text.charAt(peek));
};

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

const decodeJsonc = (text: string): Option.Option<Schema.Json> =>
  decodeJson(withoutTrailingCommas(withoutComments(text)));

const UNREADABLE =
  "not JSON, even with comments and trailing commas removed; the walk stops here";

const UNREAD = "not among the files read; judged unread";

const dirname = (path: string) => path.split("/").slice(0, -1).join("/");

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

interface Tree {
  readonly paths: ReadonlySet<string>;
  readonly read: (path: string) => string | undefined;
}

const treeOf = (contents: ReadonlyMap<string, string>): Tree => ({
  paths: new Set(contents.keys()),
  read: (path) => contents.get(path),
});

const workspacesOf = (tree: Tree): ReadonlyMap<string, string> =>
  new Map(
    [...tree.paths]
      .filter((path) => isPackageJson(path))
      .flatMap((path) =>
        decodeJson(tree.read(path) ?? "").pipe(
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
const configFile = (path: string, paths: ReadonlySet<string>) =>
  [path, `${path}.json`].find((candidate) => paths.has(candidate)) ??
  (path.endsWith(".json") ? path : `${path}.json`);

const resolveExtends = (
  from: string,
  specifier: string,
  paths: ReadonlySet<string>,
  workspaces: ReadonlyMap<string, string>
): Option.Option<string> => {
  if (isRelative(specifier)) {
    return Option.map(join(dirname(from), specifier), (path) =>
      configFile(path, paths)
    );
  }

  return Option.flatMap(inWorkspace(specifier, workspaces), ({ dir, rest }) =>
    Option.map(join(dir, rest === "" ? "tsconfig.json" : rest), (path) =>
      configFile(path, paths)
    )
  );
};

const extendsOf = (config: Schema.Json): readonly string[] => {
  const value = isJsonObject(config) ? config.extends : undefined;

  return [value ?? []].flat().filter(Predicate.isString);
};

const note = (path: string, reason: string) => `${path}: ${reason}`;

const chainFrom = (
  start: string,
  tree: Tree,
  workspaces: ReadonlyMap<string, string>
) => {
  const chain = [start];
  const notes: string[] = [];

  for (const next of chain) {
    const content = tree.read(next);
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
      Option.toArray(resolveExtends(next, specifier, tree.paths, workspaces))
    );

    chain.push(...parents.filter((parent) => !chain.includes(parent)));
  }

  return { chain: chain.map((path) => RepoPath.make(path)), notes };
};

export const tsconfigChain = (
  start: RepoPath,
  files: ReadonlyMap<string, string>
): {
  readonly chain: readonly RepoPath[];
  readonly notes: readonly string[];
} => {
  const tree = treeOf(files);

  return chainFrom(start, tree, workspacesOf(tree));
};

interface Token {
  readonly kind: "mark" | "string" | "word";
  readonly text: string;
}

const isWordChar = (char: string) => /[\w$]/u.test(char);

const literal = (quote: string, body: string): Token =>
  quote === "`" && body.includes("${")
    ? { kind: "mark", text: quote }
    : { kind: "string", text: body.replaceAll(/\\(?<char>.)/gu, "$<char>") };

// Not a full lexer: a regex literal that holds a quote can mislead it.
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

const LOADERS = new Set(["URL", "import", "require", "resolve"]);

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

const OPENS = new Set(["(", "[", "{"]);

const CLOSES = new Set([")", "]", "}"]);

interface PluginList {
  readonly specifiers: readonly string[];
  readonly opaque: boolean;
}

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

const isJsonConfig = (path: string) =>
  /\.jsonc?$/u.test(path) || basename(path) === ".oxlintrc";

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

const relativeFrom = (
  from: string,
  specifiers: readonly string[]
): readonly RepoPath[] =>
  specifiers
    .filter(isRelative)
    .flatMap((specifier) => Option.toArray(join(dirname(from), specifier)))
    .map((path) => RepoPath.make(path));

export const jsPluginSpecifiers = (config: RepoFile): readonly RepoPath[] =>
  relativeFrom(config.path, lintNames(config).plugins);

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

interface Settled {
  readonly anchor: string;
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

const wordsOf = (command: string): readonly string[] =>
  command
    .split(/[\s;&|()<>`]+/u)
    .map((word) =>
      word.replaceAll(/["']/gu, "").replace(/^\$(?:\{\w+\}|\w+)\//u, "")
    )
    .flatMap((word) => [word, word.slice(word.indexOf("=") + 1)])
    .flatMap((word) => [word, word.replace(/^\/+/u, "")])
    .map(withoutDotSlash);

// A command may name one of these, yet it stays editable: dependency edits
// are allowed, as in `package.json`, where only the scripts are judged.
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

const walkImports = (
  seeds: readonly string[],
  tree: Tree,
  follows: (path: string) => boolean = () => true
): readonly string[] => {
  const queue = [...seeds];
  const globs: string[] = [];

  for (const path of queue) {
    const content = tree.read(path);

    if (content !== undefined) {
      const targets = runsFrom(path, content, tree.paths)
        .filter(follows)
        .map((target) => settle(target, tree.paths));

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

interface LintSources {
  readonly anchors: readonly string[];
  readonly globs: readonly string[];
  readonly notes: readonly string[];
}

const lintSources = (
  tree: Tree,
  workspaces: ReadonlyMap<string, string>
): LintSources => {
  const { paths } = tree;
  const configs = [...paths].filter(isLintConfig).toSorted();

  const named = configs.map((path) => {
    const names = lintNames({ content: tree.read(path) ?? "", path });

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
      ...walkImports(files, tree),
    ],
    notes: named.flatMap((config) => config.notes),
  };
};

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

const stemOf = (path: string) =>
  hasExtension(path) ? path.slice(0, path.lastIndexOf(".")) : path;

interface PluginName {
  readonly folder: boolean;
  readonly path: string;
}

const namesPlugin = (candidate: string, plugin: PluginName) =>
  plugin.folder
    ? candidate === plugin.path || candidate.startsWith(`${plugin.path}/`)
    : stemOf(candidate) === stemOf(plugin.path);

const readingsOf = (from: string, text: string): readonly string[] => {
  if (text.startsWith("../")) {
    return Option.toArray(join(dirname(from), text));
  }

  const rooted = withoutDotSlash(text);

  return text.startsWith("./")
    ? [...Option.toArray(join(dirname(from), text)), rooted]
    : [rooted];
};

const fixturesOf = (
  pluginPaths: readonly string[],
  files: readonly string[],
  read: Tree["read"]
): readonly Glob[] => {
  const plugins = pluginPaths.map((plugin): PluginName =>
    isIndex(plugin)
      ? { folder: true, path: dirname(plugin) }
      : {
          folder: files.some((path) => path.startsWith(`${plugin}/`)),
          path: plugin,
        }
  );

  const beside = plugins.flatMap((plugin) => {
    const folder = dirname(plugin.path);

    return folder === ""
      ? []
      : FIXTURE_FOLDERS.map((name) => `${folder}/${name}/**`);
  });

  const lastNames = plugins.map((plugin) => basename(stemOf(plugin.path)));

  const naming = files.filter((path) => {
    if (plugins.length === 0 || !TEST_FILE.test(path)) {
      return false;
    }

    const content = read(path) ?? "";

    return (
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

// Fixture folders are never taken at the repo root, where they hold the
// project's own tests.
export const ruleFixtures = (
  pluginPaths: readonly string[],
  files: readonly string[],
  contents: ReadonlyMap<string, string>
): readonly Glob[] =>
  fixturesOf(pluginPaths, files, (path) => contents.get(path));

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

const decodeYaml = (text: string): Option.Option<Schema.Json> =>
  Option.flatten(
    Option.liftThrowable((source: string) =>
      decodeAnyJson(parse(source, { logLevel: "error", strict: false }))
    )(text)
  );

interface HookCommands {
  readonly commands: readonly string[];
  readonly notes: readonly string[];
}

const unreadable = (path: string, reason: string): HookCommands => ({
  commands: [],
  notes: [note(path, reason)],
});

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

const hookSources = (tree: Tree, sorted: readonly string[]) => {
  const configs = sorted.filter((path) =>
    hookConfigGlobs.some((glob) => matchGlob(glob, path))
  );

  const read = configs.map((path) =>
    hookCommands({ content: tree.read(path) ?? "", path })
  );

  const scripts = commandScripts(
    read.flatMap((hook) => hook.commands),
    tree.paths
  );

  const code = configs.filter((path) => CODE.test(path));

  return {
    globs: [...scripts, ...walkImports([...scripts, ...code], tree)],
    notes: read.flatMap((hook) => hook.notes),
  };
};

const SCRIPTS = "#/scripts";

export interface JudgeClosure {
  readonly paths: readonly Glob[];
  readonly pointers: readonly string[];
  readonly notes?: readonly string[];
}

// Only a check script's own folder is followed: what it imports from
// elsewhere is the product it checks, which an answer must stay free to change.
const checkScripts = (
  scripts: readonly string[],
  tree: Tree
): readonly string[] =>
  scripts.flatMap((script) => {
    const folder = dirname(script);

    return folder === ""
      ? []
      : walkImports([script], tree, (path) => path.startsWith(`${folder}/`));
  });

const commandsOf = (run: RunBlock): readonly string[] =>
  [run.setup, run.doctor, run.test, ...Object.values(run.checks)].filter(
    Predicate.isNotUndefined
  );

const closureOf = (commands: readonly string[], tree: Tree): JudgeClosure => {
  const { paths } = tree;
  const sorted = [...paths].toSorted();
  const workspaces = workspacesOf(tree);
  const named = commandScripts(commands, paths);

  const chains = sorted.flatMap((path) =>
    matchGlob("**/tsconfig*.json", path)
      ? [chainFrom(path, tree, workspaces)]
      : []
  );

  const lint = lintSources(tree, workspaces);
  const hooks = hookSources(tree, sorted);

  const derived = [
    ...named,
    ...checkScripts(named, tree),
    ...hooks.globs,
    ...chains.flatMap(({ chain }) => chain.slice(1)),
    ...lint.globs,
    ...fixturesOf(lint.anchors, sorted, tree.read),
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

export const judgeClosure = (
  run: RunBlock,
  files: readonly RepoFile[]
): JudgeClosure =>
  closureOf(
    commandsOf(run),
    treeOf(
      new Map(files.map((file) => [withoutDotSlash(file.path), file.content]))
    )
  );

// RFC 6901: `/a~1b` is the key `a/b`; `~0` is `~`.
const pointerTokens = (pointer: string): readonly string[] =>
  pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));

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

// A larger file is listed with no text.
export const MAX_FACT_BYTES = 256 * 1024;

export interface ListedFile {
  readonly path: string;
  readonly size?: number;
}

export interface ReadFile {
  readonly bytes: Uint8Array;
  readonly path: string;
}

export interface JudgeInput {
  readonly content: string;
  readonly path: RepoPath;
}

const CI_FOLDERS: ReadonlySet<string> = new Set([
  ".github/workflows",
  ".forgejo/workflows",
  ".husky",
]);

const isSeed = (path: string) =>
  dirname(path) === "" ||
  CI_FOLDERS.has(dirname(path)) ||
  path.startsWith(`${Brand.configDir}/`);

const foundCommands = (files: readonly RepoFile[]): readonly string[] => {
  const { run } = findRunBlock(files);

  return [
    run.setup,
    run.doctor,
    run.test,
    ...Object.values(run.checks ?? {}),
  ].filter(Predicate.isNotUndefined);
};

// Call again with what it returned read until it returns nothing: reading
// more can only reach more.
const judgeReads = (
  listed: readonly ListedFile[],
  texts: ReadonlyMap<string, string>
): readonly string[] => {
  const sizes = new Map(
    listed.map(({ path, size }) => [withoutDotSlash(path), size])
  );

  const wanted = new Set<string>();

  const tree: Tree = {
    paths: new Set(sizes.keys()),
    read: (path) => {
      const text = texts.get(path);

      if (text !== undefined || !sizes.has(path)) {
        return text;
      }

      if ((sizes.get(path) ?? 0) <= MAX_FACT_BYTES) {
        wanted.add(path);
      }

      return "";
    },
  };

  const files = [...tree.paths].map((path) => ({
    content: (isSeed(path) ? tree.read(path) : texts.get(path)) ?? "",
    path,
  }));

  const configStrings = files
    .filter(({ path }) => path.startsWith(`${Brand.configDir}/`))
    .flatMap(({ content }) =>
      tokensOf(content)
        .filter((token) => token.kind === "string")
        .map((token) => token.text)
    );

  closureOf([...foundCommands(files), ...configStrings], tree);

  return [...wanted].toSorted();
};

export const judgeInputs = <E, R>(
  listed: readonly ListedFile[],
  readAll: (
    paths: readonly string[]
  ) => Effect.Effect<readonly ReadFile[], E, R>
): Effect.Effect<readonly JudgeInput[], E, R> => {
  const decoder = new TextDecoder();

  const gather = (
    texts: ReadonlyMap<string, string>
  ): Effect.Effect<ReadonlyMap<string, string>, E, R> => {
    const wanted = judgeReads(listed, texts);

    return wanted.length === 0
      ? Effect.succeed(texts)
      : Effect.flatMap(readAll(wanted), (files) => {
          const got = new Map(
            files.map(({ bytes, path }) => [
              path,
              bytes.length <= MAX_FACT_BYTES ? decoder.decode(bytes) : "",
            ])
          );

          return gather(
            new Map([
              ...texts,
              ...wanted.map((path) => [path, got.get(path) ?? ""] as const),
            ])
          );
        });
  };

  return Effect.map(gather(new Map()), (texts) =>
    [...new Set(listed.map(({ path }) => withoutDotSlash(path)))]
      .filter((path) => path !== "")
      .toSorted()
      .map((path) => ({
        content: texts.get(path) ?? "",
        path: RepoPath.make(path),
      }))
  );
};
