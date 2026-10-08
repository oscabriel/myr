/**
 * The visibility cartridge, read as data (W6 609; SYN cut line 5): its
 * paths exist, one marked line plugs it in, and nothing outside it reaches
 * into it, so removing it is a deletion. The cartridge is its manifest's
 * folders, the marked composition line (the line under the marker
 * comment, which goes with it), the two `@repo/visibility` dependency lines
 * and the `ARTIFACTS_PRIVATE` binding; everything else
 * depends only on the neutral ports (`@repo/project`'s `visibility-port.ts`
 * and `env-port.ts`, the platform's `layer-gate.ts`), whose defaults are
 * the platform without it.
 *
 * Imports are read from the source with comments and the insides of
 * strings, regexes and templates blanked, so an import spelled in a comment
 * or a string never counts, and every form does: static, `import type`,
 * re-exports and `import()`.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Array,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { repoRoot } from "./root.ts";

/** The cartridge's folders, from the repo root; each ends with `/`, and each exists. */
const MANIFEST = [
  "packages/visibility/",
  "packages/project/src/visibility/",
  "apps/platform/src/visibility/",
  "apps/platform/test/visibility/",
] as const;

/**
 * Where tests of the cartridge's project side live: they go with it, so
 * they are its too, though none may be written yet.
 */
const TEST_HOMES = ["packages/project/test/visibility/"] as const;

/** Every folder that goes when the cartridge goes. */
const CARTRIDGE = [...MANIFEST, ...TEST_HOMES];

/**
 * Where the line that plugs the cartridge in lives (`ports.ts` merges every
 * cartridge `cartridges.ts` names over the platform's ports), and the one
 * module it names.
 */
const COMPOSITION = {
  file: "apps/platform/src/cartridges.ts",
  module: "./visibility/live.ts",
};

/** The marker, spelled so this file never carries it. */
const MARKER = ["//", "cartridge:", "visibility"].join(" ");

const PACKAGE = "@repo/visibility";

/** The workspaces that depend on the package: the cartridge's implementations live in them. */
const DEPENDENTS = [
  "apps/platform/package.json",
  "packages/project/package.json",
];

/** The private namespace's binding, by its name, spelled so a search for it finds the allowed files below. */
const BINDING = ["ARTIFACTS", "PRIVATE"].join("_");

/**
 * The files outside the cartridge that may name the binding: the platform's
 * config, generated types and env decode, its tests' fake env and type
 * fences, principle 7's web fence, and these tests.
 */
const NAMES_BINDING = new Set([
  "apps/platform/wrangler.jsonc",
  "apps/platform/worker-configuration.d.ts",
  "apps/platform/src/platform.ts",
  "apps/platform/test/fake-env.ts",
  "apps/platform/test/bindings.test.ts",
  "apps/platform/test/platform.test.ts",
  "apps/platform/test/env.test-d.ts",
  "apps/web/test/env.test-d.ts",
  "packages/config/test/web-wiring.test.ts",
  "packages/config/test/cartridge.test.ts",
]);

/** Prose and binary files: they wire nothing. */
const NOT_WIRING = /\.(?:md|png|ico|svg|woff2?|ttf|otf|jpg|webp|gif|lockb)$/u;

const isCartridge = (file: string) =>
  CARTRIDGE.some((folder) => file.startsWith(folder));

const isSource = (file: string) => /\.tsx?$/u.test(file);

// ------------------------------------------------------------ the repo

/** Every file git tracks or would track (ignored files left out), from the repo root. */
const committable = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const cwd = yield* repoRoot;

  const handle = yield* spawner.spawn(
    ChildProcess.make(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd }
    )
  );

  const [listed, code] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
    { concurrency: "unbounded" }
  );

  if (code !== 0) {
    return yield* Effect.die(`git ls-files exited with ${code}`);
  }

  return listed.split("\n").filter((line) => line.length > 0);
}).pipe(Effect.scoped);

/** A file under the repo root, as text; one deleted but not yet staged reads as none. */
const textOf = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const at = path.join(yield* repoRoot, file);

    return (yield* fs.exists(at))
      ? Option.some(yield* fs.readFileString(at))
      : Option.none<string>();
  });

/** Every committable file with its text, `filter` deciding which. */
const filesWhere = (filter: (file: string) => boolean) =>
  Effect.flatMap(committable, (files) =>
    Effect.forEach(files.filter(filter), (file) =>
      Effect.map(textOf(file), (text) =>
        Option.map(text, (content) => ({ content, file }))
      )
    )
  ).pipe(Effect.map(Array.getSomes));

// --------------------------------------------------------- reading code

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
 * One pass over a file's source: `chars` ends with comments and the insides
 * of strings, regexes and templates blanked, keeping every offset.
 */
interface Lexer {
  readonly chars: string[];
  readonly content: string;
  /** The brace depth outside each enclosing template's `${`, innermost last. */
  readonly outer: number[];
  /** Each string literal's contents, by the offset of its opening quote. */
  readonly strings: Map<number, string>;
  at: number;
  depth: number;
  inTemplate: boolean;
  /** The last code token read: a punctuation character or a word. */
  previous: string;
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
 * templates, blanked, keeping every offset and line break, so import
 * syntax inside them is never read.
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
      STEPS.some((step) => step(lexer));
    }
  }

  return { code: lexer.chars.join(""), strings: lexer.strings };
};

// Over masked code, each alternative ends at a specifier's opening quote: a
// static import or re-export (`… from "x"`, maybe across lines), a bare
// `import "x"`, or a dynamic `import("x")` (`typeof import("x")` too).
const IMPORT =
  /(?<![.\w$])(?:import|export)[\s{*][^;]*?\bfrom\s*["']|(?<![.\w$])import\s*["']|(?<![.\w$])import\s*\(\s*["']/gu;

/** One import of a file: what it names, and the line it is on (1-based). */
interface Import {
  readonly line: number;
  readonly specifier: string;
}

/** Every import, re-export and dynamic import in a file, in source order. */
const importsOf = (content: string): readonly Import[] => {
  const { code, strings } = mask(content);

  return [...code.matchAll(IMPORT)].flatMap((match) => {
    const quote = match.index + match[0].length - 1;
    const specifier = strings.get(quote);

    return specifier === undefined || specifier.length === 0
      ? []
      : [{ line: content.slice(0, quote).split("\n").length, specifier }];
  });
};

// ------------------------------------------------------------ resolving

/** `a/b/../c/./d` as `a/c/d`; none when it climbs out of the repo. */
const normalize = (path: string): Option.Option<string> => {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "..") {
      if (parts.length === 0) {
        return Option.none();
      }

      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return Option.some(parts.join("/"));
};

const Manifest = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String)
  ),
  exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  name: Schema.String,
  peerDependencies: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String)
  ),
});

type Manifest = typeof Manifest.Type;

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Manifest)
);

/** A workspace: its folder (with `/`) and its manifest. */
interface Workspace {
  readonly dir: string;
  readonly manifest: Manifest;
}

/** Every workspace package in the repo: the `package.json` files under `apps/` and `packages/`. */
const workspaces = Effect.flatMap(
  filesWhere((file) => /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(file)),
  (files) =>
    Effect.forEach(files, ({ content, file }) =>
      Effect.map(decodeManifest(content), (manifest) => ({
        dir: file.slice(0, -"package.json".length),
        manifest,
      }))
    )
);

/** The file an `exports` subpath names, through a key or one `*` wildcard. */
const exported = (
  workspace: Workspace,
  subpath: string
): Option.Option<string> => {
  const table = workspace.manifest.exports ?? {};
  const wanted = subpath === "" ? "." : `./${subpath}`;

  const target = Option.orElse(Option.fromUndefinedOr(table[wanted]), () =>
    Option.firstSomeOf(
      Object.entries(table).map(([key, value]) => {
        const [before = "", after] = key.split("*");

        return after !== undefined &&
          wanted.startsWith(before) &&
          wanted.endsWith(after) &&
          Schema.is(Schema.String)(value)
          ? Option.some(
              value.replace(
                "*",
                wanted.slice(before.length, wanted.length - after.length)
              )
            )
          : Option.none();
      })
    )
  );

  return Option.flatMap(
    Option.filter(target, Schema.is(Schema.String)),
    (file) => normalize(`${workspace.dir}${file}`)
  );
};

/** The repo path an import reaches: a relative path, or a workspace package's export; none for anything else. */
const resolved = (
  from: string,
  specifier: string,
  all: readonly Workspace[]
): Option.Option<string> => {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return normalize(`${from.slice(0, from.lastIndexOf("/") + 1)}${specifier}`);
  }

  const owner = all.find(
    ({ manifest }) =>
      specifier === manifest.name || specifier.startsWith(`${manifest.name}/`)
  );

  return owner === undefined
    ? Option.none()
    : exported(owner, specifier.slice(owner.manifest.name.length + 1));
};

/** Whether an import reaches into the cartridge: its package by name, or a path inside it. */
const reachesCartridge = (
  from: string,
  specifier: string,
  all: readonly Workspace[]
) =>
  specifier === PACKAGE ||
  specifier.startsWith(`${PACKAGE}/`) ||
  Option.exists(
    resolved(from, specifier, all),
    (target) =>
      isCartridge(target) || CARTRIDGE.some((folder) => `${target}/` === folder)
  );

const dependencyNames = (manifest: Manifest) =>
  Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  });

// ---------------------------------------------------------------- tests

const provided = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >
) => effect.pipe(Effect.provide(NodeServices.layer));

describe("the visibility cartridge's reader", () => {
  it("reads every import form, and none in comments or strings", () => {
    const source = [
      'import { a } from "./a.ts";',
      'import type { B } from "@repo/b/sub";',
      'export * from "../c.ts";',
      'import "./d.ts";',
      'const e = () => import("./e.ts");',
      'type F = typeof import("./f.ts");',
      '// import { g } from "./g.ts";',
      '/* import("./h.ts") */',
      "const i = \"import { i } from './i.ts'\";",
      'const j = `import("./j.ts")`;',
      'const k = /import\\("\\.\\/k\\.ts"\\)/u;',
    ].join("\n");

    expect(importsOf(source).map(({ specifier }) => specifier)).toStrictEqual([
      "./a.ts",
      "@repo/b/sub",
      "../c.ts",
      "./d.ts",
      "./e.ts",
      "./f.ts",
    ]);
  });

  it("resolves a package's subpath through its exports, wildcard included", () => {
    const project: Workspace = {
      dir: "packages/project/",
      manifest: {
        exports: { "./*": "./src/*.ts", "./claim": "./src/claim.ts" },
        name: "@repo/project",
      },
    };

    expect(
      [
        "@repo/project/claim",
        "@repo/project/visibility/state",
        "@repo/elsewhere/x",
        "./visibility/live.ts",
      ].map((specifier) =>
        Option.getOrNull(
          resolved("apps/platform/src/ports.ts", specifier, [project])
        )
      )
    ).toStrictEqual([
      "packages/project/src/claim.ts",
      "packages/project/src/visibility/state.ts",
      null,
      "apps/platform/src/visibility/live.ts",
    ]);
  });
});

describe("the visibility cartridge", () => {
  it.effect("has every folder of its manifest", () =>
    provided(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        const missing = yield* Effect.filter(MANIFEST, (folder) =>
          Effect.map(fs.exists(path.join(root, folder)), (found) => !found)
        );

        expect(missing).toStrictEqual([]);
      })
    )
  );

  it.effect(
    "is plugged in by one marked line, which names its live module alone",
    () =>
      provided(
        Effect.gen(function* () {
          const sources = yield* filesWhere(isSource);

          // The marked line is the one under the marker comment.
          const marked = sources.flatMap(({ content, file }) => {
            const lines = content.split("\n");

            return lines.flatMap((text, index) =>
              text.includes(MARKER)
                ? [{ file, text: lines[index + 1] ?? "" }]
                : []
            );
          });

          expect(marked.map(({ file }) => file)).toStrictEqual([
            COMPOSITION.file,
          ]);

          expect(
            marked.map(({ text }) =>
              importsOf(text).map(({ specifier }) => specifier)
            )
          ).toStrictEqual([[COMPOSITION.module]]);
        })
      )
  );

  it.effect(
    "is reached by no file outside it but through its marked line",
    () =>
      provided(
        Effect.gen(function* () {
          const all = yield* workspaces;

          const outside = yield* filesWhere(
            (file) => isSource(file) && !isCartridge(file)
          );

          const reaching = outside.flatMap(({ content, file }) => {
            const lines = content.split("\n");

            // `line` is 1-based, so the line above it is `lines[line - 2]`.
            return importsOf(content)
              .filter(
                ({ line, specifier }) =>
                  !(lines[line - 2] ?? "").includes(MARKER) &&
                  reachesCartridge(file, specifier, all)
              )
              .map(({ line, specifier }) => `${file}:${line} ${specifier}`);
          });

          expect(reaching).toStrictEqual([]);
        })
      )
  );

  it.effect(
    "is a dependency of the platform and the project service alone",
    () =>
      provided(
        Effect.gen(function* () {
          const all = yield* workspaces;

          const depending = all
            .filter(({ manifest }) =>
              dependencyNames(manifest).includes(PACKAGE)
            )
            .map(({ dir }) => `${dir}package.json`)
            .toSorted();

          expect(depending).toStrictEqual(DEPENDENTS);
        })
      )
  );

  it.effect(
    "has its private namespace's binding named only where the platform wires it, or inside the cartridge",
    () =>
      provided(
        Effect.gen(function* () {
          const naming = yield* filesWhere((file) => !NOT_WIRING.test(file));

          const outside = naming
            .filter(
              ({ content, file }) =>
                content.includes(BINDING) && !isCartridge(file)
            )
            .map(({ file }) => file);

          expect(
            outside.filter((file) => !NAMES_BINDING.has(file))
          ).toStrictEqual([]);
        })
      )
  );
});
