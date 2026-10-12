/**
 * The visibility cartridge is its manifest's folders, the marked composition
 * line, the two `@repo/visibility` dependency lines and the
 * `ARTIFACTS_PRIVATE` binding; everything else depends only on the neutral
 * ports, whose defaults are the platform without it. Imports are read with
 * comments and the insides of strings, regexes and templates blanked.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, FileSystem, Option, Path, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { committable, readsAtOnce, repoRoot, textOf } from "./root.ts";

const MANIFEST = [
  "packages/visibility/",
  "packages/project/src/visibility/",
  "apps/platform/src/visibility/",
  "apps/platform/test/visibility/",
] as const;

const TEST_HOMES = ["packages/project/test/visibility/"] as const;

const RUNS_ITS_WORLD = [
  "apps/cli/test/local/env-set-live.test.ts",
  "packages/config/test/seed-layer.test.ts",
] as const;

const ITS_CONTENT = ["examples/datekit/layers/"] as const;

/**
 * Every folder and file that goes when the cartridge goes. Deleting it also
 * takes the lines that name it: the marked line in `cartridges.ts`; the two
 * `@repo/visibility` dependency lines; `ARTIFACTS_PRIVATE` and `MASTER_KEY`
 * in the platform's `wrangler.jsonc`, `.env.schema` and `platform.ts`, its
 * tests' fake env (`withPrivateNamespace` and its uses), `bindings.test.ts`,
 * `platform.test.ts` and `env.test-d.ts`, then `bun run types`; the private
 * namespace and `MASTER_KEY` rows in `bootstrap.test.ts`; and datekit's three
 * `Layer` lines in `seed.test.ts`.
 */
const CARTRIDGE = [
  ...MANIFEST,
  ...TEST_HOMES,
  ...RUNS_ITS_WORLD,
  ...ITS_CONTENT,
];

const COMPOSITION = {
  file: "apps/platform/src/cartridges.ts",
  module: "./visibility/live.ts",
};

/** The marker, spelled so this file never carries it. */
const MARKER = ["//", "cartridge:", "visibility"].join(" ");

const PACKAGE = "@repo/visibility";

const DEPENDENTS = [
  "apps/platform/package.json",
  "packages/project/package.json",
];

/** Spelled so a search for the binding's name finds only the allowed files below. */
const BINDING = ["ARTIFACTS", "PRIVATE"].join("_");

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

const NOT_WIRING = /\.(?:md|png|ico|svg|woff2?|ttf|otf|jpg|webp|gif|lockb)$/u;

const isCartridge = (file: string) =>
  CARTRIDGE.some((folder) => file.startsWith(folder));

const isSource = (file: string) => /\.tsx?$/u.test(file);

const filesWhere = (filter: (file: string) => boolean) =>
  Effect.flatMap(committable, (files) =>
    Effect.forEach(
      files.filter(filter),
      (file) =>
        Effect.map(textOf(file), (text) =>
          Option.map(text, (content) => ({ content, file }))
        ),
      readsAtOnce
    )
  ).pipe(Effect.map(Array.getSomes));

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

interface Lexer {
  readonly chars: string[];
  readonly content: string;
  readonly outer: number[];
  readonly strings: Map<number, string>;
  at: number;
  depth: number;
  inTemplate: boolean;
  previous: string;
}

const blank = (lexer: Lexer, from: number, to: number) => {
  for (let at = from; at < Math.min(to, lexer.chars.length); at += 1) {
    if (lexer.chars[at] !== "\n") {
      lexer.chars[at] = " ";
    }
  }
};

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

interface Import {
  readonly line: number;
  readonly specifier: string;
}

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

interface Workspace {
  readonly dir: string;
  readonly manifest: Manifest;
}

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
  it.effect(
    "has every folder of its manifest, every test outside it that runs its world, and the example content only it can seed",
    () =>
      provided(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* repoRoot;

          const missing = yield* Effect.filter(
            [...MANIFEST, ...RUNS_ITS_WORLD, ...ITS_CONTENT],
            (each) =>
              Effect.map(fs.exists(path.join(root, each)), (found) => !found)
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
