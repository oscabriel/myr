/**
 * Import direction's pure core: which imports cross a line AGENTS.md
 * principle 6 draws. `scripts/imports.ts` feeds it the committable TypeScript
 * files and the workspaces; tests feed it fixture trees.
 *
 * The rules, in order. An import reports the first one it breaks:
 *
 * 1. `app-imports-app`: apps never import apps, by name or by path.
 * 2. `undeclared`: a workspace imports only the `@repo/*` packages its
 *    `package.json` lists. The root's `scripts/` and `infra/` are the root's.
 * 3. `matrix`: a workspace imports only the packages its `Matrix` row names
 *    (and only the subpaths `OnlySubpaths` names, where it names any), and
 *    a folder `FolderSubpaths` names also the subpaths it lists.
 * 4. `adapter-through-port`: a port file never imports or re-exports its own
 *    adapters, and nothing reaches into another workspace by a relative path
 *    (the root's files only from config's tests).
 * 5. `worker-host`: Worker code, and everything it imports, stays free of host
 *    code; in packages, host code lives only in `/local` and `/bun` adapters.
 * 6. `test-only`: the test kit and the test principal are imported only from
 *    `test/` directories.
 * 7. `infra-only`: `alchemy` stays in `infra/`.
 */
import { Option } from "effect";

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface Workspace {
  /** The workspace's folder, relative to the repo root: `apps/platform`. The root's is `""`. */
  readonly dir: string;
  readonly name: string;
  /** Every package named in `dependencies` and `devDependencies`. */
  readonly dependencies: readonly string[];
  /**
   * `package.json`'s `exports`: each subpath (`.`, `./ids`, `./*`) and the
   * files it names, relative to `dir`, with conditions flattened.
   */
  readonly exports?: Readonly<Record<string, readonly string[]>>;
}

export type ImportRule =
  | "app-imports-app"
  | "undeclared"
  | "matrix"
  | "adapter-through-port"
  | "worker-host"
  | "test-only"
  | "infra-only";

export interface ImportViolation {
  readonly path: string;
  /** 1-based: the line the specifier is on. */
  readonly line: number;
  readonly specifier: string;
  readonly rule: ImportRule;
  /**
   * For Worker code that reaches host code through other files: each file
   * the import leads through, then the host specifier it ends at.
   */
  readonly via?: readonly string[];
}

export interface Import {
  readonly specifier: string;
  /** 1-based: the line the specifier is on. */
  readonly line: number;
  /** `import type`, `export type` or `typeof import(…)`. These count too. */
  readonly typeOnly: boolean;
}

/** Every package in the direction table: what the test kit may import. */
const EVERY_PACKAGE: readonly string[] = [
  "@repo/agent-kit",
  "@repo/artifacts",
  "@repo/brand",
  "@repo/checks",
  "@repo/gate",
  "@repo/git",
  "@repo/project",
  "@repo/protocol",
  "@repo/rules",
  "@repo/sdk",
  "@repo/visibility",
];

/**
 * Which workspace packages each workspace may import, by workspace name. A
 * row for a package that doesn't exist yet matches nothing; a workspace with
 * no row may import none. Files outside a workspace's `src/` (tests, config)
 * may also import `@repo/config`. Where `@repo/testkit` may appear is the
 * `test-only` rule's to say.
 *
 * Narrower than a row: `OnlySubpaths`. Wider, for one folder:
 * `FolderSubpaths` (the web's dev backend).
 */
export const Matrix = {
  "@repo/agent-kit": ["@repo/brand", "@repo/checks", "@repo/protocol"],
  "@repo/artifacts": ["@repo/protocol"],
  "@repo/brand": [],
  "@repo/checks": ["@repo/brand", "@repo/protocol"],
  "@repo/cli": [
    "@repo/agent-kit",
    "@repo/artifacts",
    "@repo/brand",
    "@repo/checks",
    "@repo/gate",
    "@repo/git",
    "@repo/protocol",
    "@repo/rules",
    "@repo/sdk",
    "@repo/visibility",
  ],
  "@repo/gate": ["@repo/checks", "@repo/protocol"],
  "@repo/git": ["@repo/artifacts", "@repo/brand", "@repo/protocol"],
  "@repo/platform": [
    "@repo/agent-kit",
    "@repo/artifacts",
    "@repo/brand",
    "@repo/checks",
    "@repo/gate",
    "@repo/git",
    "@repo/project",
    "@repo/protocol",
    "@repo/rules",
    "@repo/visibility",
  ],
  "@repo/project": [
    "@repo/artifacts",
    "@repo/brand",
    "@repo/checks",
    "@repo/gate",
    "@repo/git",
    "@repo/protocol",
    "@repo/rules",
    "@repo/visibility",
  ],
  "@repo/protocol": ["@repo/brand"],
  "@repo/rules": ["@repo/protocol", "@repo/sdk"],
  "@repo/sandbox": [
    "@repo/brand",
    "@repo/checks",
    "@repo/git",
    "@repo/project",
    "@repo/protocol",
    "@repo/rules",
    "@repo/visibility",
  ],
  "@repo/sdk": ["@repo/brand", "@repo/protocol"],
  // Its own consumers are tests only.
  "@repo/testkit": EVERY_PACKAGE,
  "@repo/visibility": [
    "@repo/artifacts",
    "@repo/brand",
    "@repo/checks",
    "@repo/git",
    "@repo/protocol",
  ],
  "@repo/web": ["@repo/brand", "@repo/protocol"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/**
 * The subpaths of `@repo/checks` that are pure: no port, no process, no I/O.
 * `check-runner` (a port) and `check-runner/local` (a process) are not.
 */
export const ChecksPureSubpaths: readonly string[] = [
  "classify",
  "finder",
  "judge",
  "kinds",
  "kinds/*",
  "phases",
  "red-first",
  "weak-shapes",
];

/**
 * `Matrix` edges that allow only some subpaths of the imported package, by
 * importer, then imported package. `*` matches the rest of a subpath.
 */
export const OnlySubpaths = {
  // The CLI runs on a person's machine (spec §4.1): rules through `/bun` and
  // `/json` only (never the Worker Loader's `/worker`), repos only on local
  // disk (never through the binding or the REST API), and visibility's
  // `.env.schema` parser alone (W6).
  "@repo/cli": {
    "@repo/artifacts": ["fetch", "repo-host", "repo-host/local"],
    "@repo/rules": [
      "defaults",
      "finish",
      "rules-evaluator",
      "rules-evaluator/bun",
      "rules-evaluator/json",
    ],
    "@repo/visibility": ["env-schema", "env-schema/*"],
  },
  "@repo/gate": { "@repo/checks": ChecksPureSubpaths },
  // Both sides of the platform's service binding decode the Lander's jobs
  // with one schema; the sandbox takes nothing else of the project.
  "@repo/sandbox": {
    "@repo/project": ["lander/wire"],
    "@repo/rules": ["rules-evaluator"],
  },
  "@repo/sdk": { "@repo/protocol": ["domain/*"] },
} as const satisfies Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
>;

/**
 * What the web's dev backend may import of the packages that run the project
 * service: the memory and JSON adapters, the in-process answer runner, the
 * rules' defaults, the ports those adapters fill, and the project service
 * itself. Never a real adapter: no binding, REST, isogit, SQLite, D1, Worker
 * Loader, R2, local-disk or Bun one.
 */
const DEV_WORLD: readonly string[] = [
  "*/inline",
  "*/json",
  "*/memory",
  "alarms",
  "answer-runs",
  "check-runner",
  "defaults",
  "evidence-store",
  "front-page",
  "lander",
  "project",
  "project-store",
  "projection",
  "projects",
  "repo-host",
  "rules-evaluator",
];

/**
 * Wider than a row, for one folder: the packages its files may import
 * besides their workspace's row, each with the only subpaths allowed, by
 * folder, then package. The web's dev backend (`#backend` under the
 * `development` condition, spec §4.1) runs the project service in process
 * over memory adapters; nothing else in the web imports them, and the
 * production build carries none of it (W5 505).
 */
export const FolderSubpaths = {
  "apps/web/src/dev/": {
    "@repo/artifacts": DEV_WORLD,
    "@repo/checks": DEV_WORLD,
    "@repo/git": DEV_WORLD,
    "@repo/project": DEV_WORLD,
    "@repo/rules": DEV_WORLD,
  },
} as const satisfies Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
>;

/** The folders whose files run in a Worker. */
export const WorkerRoots: readonly string[] = [
  "apps/platform/src/",
  "apps/sandbox/src/",
  "apps/web/src/",
];

/**
 * The `node:*` builtins Worker code may import: those Workers' `nodejs_compat`
 * serves. Widen with a reason.
 */
export const WorkerNodeAllowed: readonly string[] = [
  "node:async_hooks",
  "node:buffer",
  "node:crypto",
  "node:events",
  "node:path",
  "node:stream",
  "node:util",
];

/**
 * Specifiers that need a host process (Bun or Node). A trailing `/*` matches a
 * whole scope; any other entry matches itself and its subpaths.
 */
export const HostOnly: readonly string[] = [
  "@effect/platform-bun",
  "@effect/platform-node",
  "@opentui/*",
  "child_process",
  "node:child_process",
];

/**
 * What a file under `src/<port>/` is called when it is an adapter
 * (AGENTS.md "Nouns"), plus the adapters later ports name. `memory-fs` is a
 * `memory` adapter's.
 */
export const AdapterNames: readonly string[] = [
  "binding",
  "bun",
  "env-spec",
  "inline",
  "isogit",
  "json",
  "local",
  "memory",
  "r2",
  "repo-host",
  "rest",
  "sqlite",
  "webcrypto",
  "worker",
];

/** Host code in a package lives only in these adapters, as files or folders. */
const HOST_ADAPTERS = new Set(["bun", "local"]);

const TESTKIT = "@repo/testkit";

const TEST_ONLY = [TESTKIT, "@repo/protocol/testing"] as const;

const CONFIG = "@repo/config";

/**
 * The one place a workspace may reach the root's files by a relative path:
 * config's tests drive the root's fence (`scripts/`, `tools/oxlint/`,
 * `oxlint.config.ts`).
 */
const FENCE_TESTS = "packages/config/test/";

/** What a reader can do about each rule, one line each. */
export const RuleHints: Readonly<Record<ImportRule, string>> = {
  "adapter-through-port":
    "import an adapter by its own subpath (@repo/<package>/<port>/<adapter>), never through its port file, and reach another workspace by its name, never by a relative path (only packages/config/test reaches the root's files).",
  "app-imports-app":
    "apps import packages only; move what both need into a package.",
  "infra-only": "alchemy stays in infra/.",
  matrix:
    "this workspace (or this folder) may not import that package or subpath; Matrix, OnlySubpaths and FolderSubpaths in scripts/lib/imports.ts are the allow-list.",
  "test-only":
    "@repo/testkit and @repo/protocol/testing are imported only from test/ directories.",
  undeclared:
    "list the package in this workspace's package.json, if Matrix allows the edge.",
  "worker-host":
    "Worker code, and every module it imports, stays host-free: host code lives only in a package's /local or /bun adapter, which Worker code never imports.",
};

// ---------------------------------------------------------------- reading

/** Punctuation after which a `/` starts a regex rather than a division. */
const BEFORE_REGEX = new Set("(,=:[!&|?{};+-*%<>~^");

const KEYWORDS_BEFORE_REGEX = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

const WORD = /[\w$]/u;

const SPACE = /\s/u;

/**
 * A pass over one file's source. `chars` starts as the source and ends with
 * comments and the insides of strings, regexes and templates blanked.
 */
interface Lexer {
  readonly content: string;
  readonly chars: string[];
  /** Each string literal's contents, by the offset of its opening quote. */
  readonly strings: Map<number, string>;
  /** The brace depth outside each enclosing template's `${`, innermost last. */
  readonly outer: number[];
  depth: number;
  inTemplate: boolean;
  /** The last code token read: a punctuation character or a word. */
  previous: string;
  at: number;
}

/** Blanks `[from, to)`, keeping line breaks. */
const blank = (lexer: Lexer, from: number, to: number) => {
  for (let at = from; at < Math.min(to, lexer.chars.length); at += 1) {
    if (lexer.chars[at] !== "\n") {
      lexer.chars[at] = " ";
    }
  }
};

/** The offset of the `/` that closes the regex opening at `start`, or -1 when its line ends first. */
const regexEnd = (content: string, start: number) => {
  let inClass = false;
  let at = start + 1;

  while (at < content.length && content[at] !== "\n") {
    const char = content[at];

    if (char === "/" && !inClass) {
      return at;
    }

    if (char === "[" || char === "]") {
      inClass = char === "[";
    }

    at += char === "\\" ? 2 : 1;
  }

  return -1;
};

/** A template's text, up to its closing backtick or its next `${`. */
const templateText = (lexer: Lexer) => {
  const { content } = lexer;
  const start = lexer.at;

  while (
    lexer.at < content.length &&
    content[lexer.at] !== "`" &&
    !content.startsWith("${", lexer.at)
  ) {
    lexer.at += content[lexer.at] === "\\" ? 2 : 1;
  }

  blank(lexer, start, lexer.at);
  lexer.inTemplate = false;

  if (content.startsWith("${", lexer.at)) {
    lexer.outer.push(lexer.depth);
    lexer.depth = 0;
    lexer.previous = "{";
    lexer.at += 2;
  } else {
    lexer.previous = "`";
    lexer.at += 1;
  }
};

/** Each step reads one token of code if it starts at `at`, and says whether it did. */
type Step = (lexer: Lexer) => boolean;

const comment: Step = (lexer) => {
  const { at, content } = lexer;
  const line = content.startsWith("//", at);

  if (!line && !content.startsWith("/*", at)) {
    return false;
  }

  const end = line ? content.indexOf("\n", at) : content.indexOf("*/", at + 2);
  const stop = end === -1 ? content.length : end + (line ? 0 : 2);

  blank(lexer, at, stop);
  lexer.at = stop;

  return true;
};

// A string stops at its line's end, so a stray quote (an apostrophe in JSX
// text) blanks one line at most.
const quoted: Step = (lexer) => {
  const { at, content } = lexer;
  const quote = content[at] ?? "";

  if (quote !== '"' && quote !== "'") {
    return false;
  }

  let end = at + 1;

  while (
    end < content.length &&
    content[end] !== quote &&
    content[end] !== "\n"
  ) {
    end += content[end] === "\\" ? 2 : 1;
  }

  lexer.strings.set(at, content.slice(at + 1, end));
  blank(lexer, at + 1, end);
  lexer.previous = quote;
  lexer.at = end + 1;

  return true;
};

const templateStart: Step = (lexer) => {
  if (lexer.content[lexer.at] !== "`") {
    return false;
  }

  lexer.inTemplate = true;
  lexer.at += 1;

  return true;
};

const regex: Step = (lexer) => {
  const { at, content, previous } = lexer;

  const mayStart =
    content[at] === "/" &&
    (previous === "" ||
      BEFORE_REGEX.has(previous) ||
      KEYWORDS_BEFORE_REGEX.has(previous));

  const end = mayStart ? regexEnd(content, at) : -1;

  if (end === -1) {
    return false;
  }

  blank(lexer, at + 1, end);
  lexer.previous = "/";
  lexer.at = end + 1;

  return true;
};

/** The `}` that closes a template's `${`. */
const templateResume: Step = (lexer) => {
  if (
    lexer.content[lexer.at] !== "}" ||
    lexer.depth > 0 ||
    lexer.outer.length === 0
  ) {
    return false;
  }

  lexer.depth = lexer.outer.pop() ?? 0;
  lexer.inTemplate = true;
  lexer.at += 1;

  return true;
};

const word: Step = (lexer) => {
  const { content } = lexer;
  const start = lexer.at;

  while (lexer.at < content.length && WORD.test(content[lexer.at] ?? "")) {
    lexer.at += 1;
  }

  lexer.previous = content.slice(start, lexer.at) || lexer.previous;

  return lexer.at > start;
};

const punctuation: Step = (lexer) => {
  const char = lexer.content[lexer.at] ?? "";

  lexer.depth += Number(char === "{") - Number(char === "}");

  if (!SPACE.test(char)) {
    lexer.previous = char;
  }

  lexer.at += 1;

  return true;
};

const STEPS: readonly Step[] = [
  comment,
  quoted,
  templateStart,
  regex,
  templateResume,
  word,
  punctuation,
];

/**
 * The source with comments, and the insides of strings, regexes and
 * templates, blanked, keeping every offset and line break, so import syntax
 * inside them is never read. It knows TypeScript's lexical grammar as far as
 * imports need, not further.
 */
const mask = (content: string) => {
  const lexer: Lexer = {
    at: 0,
    chars: content.split(""),
    content,
    depth: 0,
    inTemplate: false,
    outer: [],
    previous: "",
    strings: new Map(),
  };

  while (lexer.at < content.length) {
    if (lexer.inTemplate) {
      templateText(lexer);
    } else {
      for (const step of STEPS) {
        if (step(lexer)) {
          break;
        }
      }
    }
  }

  return { code: lexer.chars.join(""), strings: lexer.strings };
};

// Over masked code, each alternative ends at a specifier's opening quote: a
// static import or re-export (`… from "x"`, maybe across lines), a bare
// `import "x"`, or a dynamic `import("x")`.
const IMPORT =
  /(?<![.\w$])(?<keyword>import|export)(?<clause>[\s{*][^;]*?)\bfrom\s*["']|(?<![.\w$])import\s*["']|(?<typeOf>\btypeof\s+)?(?<![.\w$])import\s*\(\s*["']/gu;

const TYPE_CLAUSE = /^\s+type[\s{*]/u;

/** `import type from "x"`: a default import named `type`. */
const DEFAULT_NAMED_TYPE = /^\s+type\s+$/u;

/** Every import, re-export and dynamic import in a file, in source order. */
export const importsOf = (file: SourceFile): readonly Import[] => {
  const { code, strings } = mask(file.content);

  return [...code.matchAll(IMPORT)].flatMap((match) => {
    const quote = match.index + match[0].length - 1;
    const specifier = strings.get(quote);

    if (specifier === undefined || specifier.length === 0) {
      return [];
    }

    const clause = match.groups?.clause;

    const typeOnly =
      match.groups?.typeOf !== undefined ||
      (clause !== undefined &&
        TYPE_CLAUSE.test(clause) &&
        !DEFAULT_NAMED_TYPE.test(clause));

    return [
      {
        line: file.content.slice(0, quote).split("\n").length,
        specifier,
        typeOnly,
      },
    ];
  });
};

// --------------------------------------------------------------- resolving

/** `a/b/../c/./d` as `a/c/d`; `undefined` when it climbs out of the repo. */
const normalize = (path: string): string | undefined => {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "..") {
      if (parts.length === 0) {
        return undefined;
      }

      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return parts.join("/");
};

const dirname = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

const isInside = (dir: string, path: string) =>
  dir === "" || path === dir || path.startsWith(`${dir}/`);

const isUnder = (roots: readonly string[], path: string) =>
  roots.some((root) => path.startsWith(root));

const isRelative = (specifier: string) =>
  specifier === "." ||
  specifier === ".." ||
  specifier.startsWith("./") ||
  specifier.startsWith("../");

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
const packageOf = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

/** Whether `name` or one of its subpaths is what `specifier` imports. */
const names = (name: string, specifier: string) =>
  specifier === name || specifier.startsWith(`${name}/`);

const STAR = "*";

/** A subpath pattern against a subpath: `domain/*` matches `domain/ask`. */
const matchesPattern = (pattern: string, subpath: string) => {
  const star = pattern.indexOf(STAR);

  if (star === -1) {
    return pattern === subpath;
  }

  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);

  return (
    subpath.length > prefix.length + suffix.length &&
    subpath.startsWith(prefix) &&
    subpath.endsWith(suffix)
  );
};

/**
 * The files a package subpath (`.`, `./ids`) names, through the exports map:
 * an exact key first, then the `*` pattern with the longest prefix.
 */
const exportTargets = (workspace: Workspace, subpath: string) => {
  const exports = workspace.exports ?? {};
  const exact = exports[subpath];

  const within = (target: string) =>
    normalize(workspace.dir === "" ? target : `${workspace.dir}/${target}`);

  if (exact !== undefined) {
    return exact.flatMap((target) => within(target) ?? []);
  }

  const [pattern] = Object.keys(exports)
    .filter((key) => key.includes(STAR) && matchesPattern(key, subpath))
    .toSorted((a, b) => b.indexOf(STAR) - a.indexOf(STAR));

  if (pattern === undefined) {
    return [];
  }

  const star = pattern.indexOf(STAR);

  const matched = subpath.slice(
    star,
    subpath.length - (pattern.length - star - 1)
  );

  return (exports[pattern] ?? []).flatMap(
    (target) => within(target.replace(STAR, matched)) ?? []
  );
};

/** The workspace a repo path belongs to: the deepest one that holds it. */
const owner = (path: string, workspaces: readonly Workspace[]) =>
  workspaces
    .filter((workspace) => isInside(workspace.dir, path))
    .toSorted((a, b) => b.dir.length - a.dir.length)[0];

const namedWorkspace = (specifier: string, workspaces: readonly Workspace[]) =>
  workspaces.find((workspace) => names(workspace.name, specifier));

/**
 * The repo paths an import reaches, without extensions guessed: a relative
 * path as written, a workspace package through its exports map. Empty for
 * anything else.
 */
const pathsOf = (
  from: string,
  specifier: string,
  workspaces: readonly Workspace[]
): readonly string[] => {
  if (isRelative(specifier)) {
    const resolved = normalize(`${dirname(from)}${specifier}`);

    return resolved === undefined ? [] : [resolved];
  }

  const workspace = namedWorkspace(specifier, workspaces);

  return workspace === undefined
    ? []
    : exportTargets(
        workspace,
        specifier === workspace.name
          ? "."
          : `.${specifier.slice(workspace.name.length)}`
      );
};

/** The file in the tree a path names, trying TypeScript's extensions. */
const fileAt = (path: string, files: ReadonlySet<string>) =>
  [
    path,
    path.replace(/\.js$/u, ".ts"),
    `${path}.ts`,
    `${path}.tsx`,
    `${path}/index.ts`,
    `${path}/index.tsx`,
  ].find((candidate) => files.has(candidate));

// ------------------------------------------------------------------ hosts

const isHostOnly = (specifier: string) =>
  HostOnly.some((entry) =>
    entry.endsWith(`/${STAR}`)
      ? specifier.startsWith(entry.slice(0, -1))
      : names(entry, specifier)
  );

/** What Worker code may not import: host-only code, or a builtin Workers don't serve. */
const isHostForWorkers = (specifier: string) =>
  isHostOnly(specifier) ||
  (specifier.startsWith("node:") &&
    !WorkerNodeAllowed.includes(specifier.split("/")[0] ?? specifier));

const PACKAGE_SRC = /^packages\/[^/]+\/src\/(?<inner>.+)$/u;

const EXTENSION = /\.(?:ts|tsx|mts|cts|js)$/u;

/** A package file host code may live in: `…/local.ts`, `…/bun/…`. */
const isHostAdapter = (inner: string) =>
  inner
    .replace(EXTENSION, "")
    .split("/")
    .some((segment) => HOST_ADAPTERS.has(segment));

/** Whether `target` is one of the port file `port`'s own adapters. */
const isAdapterOf = (port: string, target: string) => {
  const base = port.replace(EXTENSION, "");

  if (!target.startsWith(`${base}/`)) {
    return false;
  }

  const [first = ""] = target
    .slice(base.length + 1)
    .replace(EXTENSION, "")
    .split("/");

  return AdapterNames.some(
    (name) => first === name || first.startsWith(`${name}-`)
  );
};

// ------------------------------------------------------------------- rules

interface Verdict {
  readonly rule: ImportRule;
  readonly via?: readonly string[];
}

interface Tree {
  readonly workspaces: readonly Workspace[];
  readonly paths: ReadonlySet<string>;
  /** The files the test-only specifiers name, so a relative path to one counts too. */
  readonly testOnlyFiles: ReadonlySet<string>;
  readonly importsAt: (path: string) => readonly Import[];
  /** The shortest chain from a file to a specifier Workers can't import. */
  readonly hostChain: (path: string) => Option.Option<readonly string[]>;
}

interface Site {
  readonly path: string;
  readonly from: Workspace | undefined;
  readonly specifier: string;
}

type Rule = (site: Site, tree: Tree) => Option.Option<Verdict>;

const breaks = (rule: ImportRule, broken: boolean): Option.Option<Verdict> =>
  broken ? Option.some({ rule }) : Option.none();

const ROWS = new Map<string, readonly string[]>(Object.entries(Matrix));

const NARROWED = new Map(
  Object.entries(OnlySubpaths).map(([importer, edges]) => [
    importer,
    new Map(Object.entries(edges)),
  ])
);

const FOLDERS = Object.entries(FolderSubpaths).map(
  ([folder, edges]) =>
    [folder, new Map<string, readonly string[]>(Object.entries(edges))] as const
);

/** The subpaths of `name` the folder holding `path` allows, when one names it. */
const folderSubpaths = (path: string, name: string) =>
  FOLDERS.find(
    ([folder, edges]) => path.startsWith(folder) && edges.has(name)
  )?.[1].get(name);

const isApp = (workspace: Workspace | undefined) =>
  workspace?.dir.startsWith("apps/") === true;

/** The workspace an import reaches, by package name or by relative path. */
const reached = (site: Site, workspaces: readonly Workspace[]) => {
  if (!isRelative(site.specifier)) {
    return namedWorkspace(site.specifier, workspaces);
  }

  const resolved = normalize(`${dirname(site.path)}${site.specifier}`);

  return resolved === undefined ? undefined : owner(resolved, workspaces);
};

/** The `@repo/*` package an import names, unless it names its own workspace. */
const otherRepoPackage = (site: Site) => {
  const name = packageOf(site.specifier);

  return name.startsWith("@repo/") && name !== site.from?.name
    ? name
    : undefined;
};

const appImportsApp: Rule = (site, tree) => {
  const to = reached(site, tree.workspaces);

  return breaks(
    "app-imports-app",
    isApp(site.from) && isApp(to) && to !== site.from
  );
};

const undeclared: Rule = (site) => {
  const name = otherRepoPackage(site);

  return breaks(
    "undeclared",
    name !== undefined &&
      site.from !== undefined &&
      !site.from.dependencies.includes(name)
  );
};

/** Whether `from`'s file at `path` may import `specifier`, of package `name`. */
const allows = (
  from: Workspace,
  path: string,
  name: string,
  specifier: string
) => {
  const inSrc = isInside(`${from.dir}/src`, path);
  const only = NARROWED.get(from.name)?.get(name);
  const subpath = specifier.slice(name.length + 1);

  const listed =
    name === TESTKIT ||
    (name === CONFIG && !inSrc) ||
    (ROWS.get(from.name) ?? []).includes(name);

  const byRow =
    listed &&
    (only === undefined ||
      only.some((pattern) => matchesPattern(pattern, subpath)));

  const byFolder = (folderSubpaths(path, name) ?? []).some((pattern) =>
    matchesPattern(pattern, subpath)
  );

  return byRow || byFolder;
};

// The root is tooling, with no row: `undeclared` holds it.
const matrix: Rule = (site) => {
  const name = otherRepoPackage(site);
  const { from } = site;

  return breaks(
    "matrix",
    name !== undefined &&
      from !== undefined &&
      from.dir !== "" &&
      !allows(from, site.path, name, site.specifier)
  );
};

/**
 * What any workspace may read from the root by a relative path: the
 * reference data `bun run gen` writes from the one schema (AGENTS.md
 * principle 4), as JSON, which `gen:check` keeps current. The web's
 * `llms.txt` lists the CLI's commands from `docs/reference/commands.json`
 * (W5 505) rather than a copy.
 */
const GENERATED_REFERENCE = /^docs\/reference\/[^/]+\.json$/u;

/** Whether a relative import resolves to generated reference data. */
const readsReference = (site: Site) => {
  const resolved = normalize(`${dirname(site.path)}${site.specifier}`);

  return resolved !== undefined && GENERATED_REFERENCE.test(resolved);
};

const adapterThroughPort: Rule = (site, tree) => {
  const reachesOwnAdapter =
    PACKAGE_SRC.test(site.path) &&
    pathsOf(site.path, site.specifier, tree.workspaces).some((target) =>
      isAdapterOf(site.path, target)
    );

  const to = isRelative(site.specifier)
    ? reached(site, tree.workspaces)
    : undefined;

  const reachesAcross =
    to !== undefined &&
    to !== site.from &&
    (to.dir !== "" ||
      !(site.path.startsWith(FENCE_TESTS) || readsReference(site)));

  return breaks("adapter-through-port", reachesOwnAdapter || reachesAcross);
};

/** In a package, host code only in a `/local` or `/bun` adapter. */
const hostOutsideAdapter = (site: Site) => {
  const inner = PACKAGE_SRC.exec(site.path)?.groups?.inner;

  return (
    inner !== undefined && isHostOnly(site.specifier) && !isHostAdapter(inner)
  );
};

const workerHost: Rule = (site, tree) => {
  const inWorker = isUnder(WorkerRoots, site.path);

  if (
    hostOutsideAdapter(site) ||
    (inWorker && isHostForWorkers(site.specifier))
  ) {
    return Option.some({ rule: "worker-host" });
  }

  // A Worker file this one imports answers for its own imports.
  const targets = inWorker
    ? pathsOf(site.path, site.specifier, tree.workspaces)
        .flatMap((target) => fileAt(target, tree.paths) ?? [])
        .filter((target) => !isUnder(WorkerRoots, target))
    : [];

  return Option.map(
    Option.firstSomeOf(targets.map(tree.hostChain)),
    (via): Verdict => ({ rule: "worker-host", via })
  );
};

const testOnly: Rule = (site, tree) => {
  const named = TEST_ONLY.some((name) => names(name, site.specifier));

  const reachedByPath =
    isRelative(site.specifier) &&
    pathsOf(site.path, site.specifier, tree.workspaces).some((target) =>
      tree.testOnlyFiles.has(fileAt(target, tree.paths) ?? target)
    );

  return breaks(
    "test-only",
    (named || reachedByPath) &&
      !`/${site.path}`.includes("/test/") &&
      site.from?.name !== TESTKIT
  );
};

const infraOnly: Rule = (site) =>
  breaks(
    "infra-only",
    names("alchemy", site.specifier) && !site.path.startsWith("infra/")
  );

const RULES: readonly Rule[] = [
  appImportsApp,
  undeclared,
  matrix,
  adapterThroughPort,
  workerHost,
  testOnly,
  infraOnly,
];

const treeOf = (
  files: readonly SourceFile[],
  workspaces: readonly Workspace[]
): Tree => {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const paths: ReadonlySet<string> = new Set(byPath.keys());
  const imports = new Map<string, readonly Import[]>();
  const chains = new Map<string, Option.Option<readonly string[]>>();

  const importsAt = (path: string) => {
    const file = byPath.get(path);

    if (!imports.has(path)) {
      imports.set(path, file === undefined ? [] : importsOf(file));
    }

    return imports.get(path) ?? [];
  };

  const reachableFrom = (path: string) =>
    importsAt(path).flatMap(({ specifier }) =>
      pathsOf(path, specifier, workspaces).flatMap(
        (target) => fileAt(target, paths) ?? []
      )
    );

  // Breadth first, so the chain reported is a shortest one.
  const search = (start: string): Option.Option<readonly string[]> => {
    const seen = new Set([start]);
    const queue: (readonly string[])[] = [[start]];

    for (const chain of queue) {
      const path = chain.at(-1) ?? start;

      const host = importsAt(path).find((found) =>
        isHostForWorkers(found.specifier)
      );

      if (host !== undefined) {
        return Option.some([...chain, host.specifier]);
      }

      for (const reachable of reachableFrom(path)) {
        if (!seen.has(reachable)) {
          seen.add(reachable);
          queue.push([...chain, reachable]);
        }
      }
    }

    return Option.none();
  };

  const hostChain = (path: string) => {
    const known = chains.get(path) ?? search(path);

    chains.set(path, known);

    return known;
  };

  const testOnlyFiles = new Set(
    TEST_ONLY.flatMap((specifier) => pathsOf("", specifier, workspaces))
  );

  return { hostChain, importsAt, paths, testOnlyFiles, workspaces };
};

/** The first rule an import breaks, if it breaks one. */
const firstBroken = (site: Site, tree: Tree) => {
  for (const rule of RULES) {
    const verdict = rule(site, tree);

    if (Option.isSome(verdict)) {
      return verdict;
    }
  }

  return Option.none<Verdict>();
};

/** Every import that breaks a rule, in file order, then line order. */
export const findViolations = (
  files: readonly SourceFile[],
  workspaces: readonly Workspace[]
): readonly ImportViolation[] => {
  const tree = treeOf(files, workspaces);

  return files.flatMap((file) => {
    const from = owner(file.path, workspaces);

    return tree.importsAt(file.path).flatMap(({ line, specifier }) =>
      Option.match(firstBroken({ from, path: file.path, specifier }, tree), {
        onNone: () => [],
        onSome: (verdict) => [{ line, path: file.path, specifier, ...verdict }],
      })
    );
  });
};

/** One violation as `path:line: rule: specifier`, then its chain, if any. */
export const formatViolation = (violation: ImportViolation) =>
  [
    `${violation.path}:${violation.line}: ${violation.rule}: ${violation.specifier}`,
    ...(violation.via ?? []),
  ].join(" → ");
