import { describe, expect, it } from "@effect/vitest";
import { Glob } from "@repo/protocol/domain/common";
import { Territory } from "@repo/protocol/domain/territory";
import { RepoPath } from "@repo/protocol/ids";
import {
  groups,
  OutOfScope,
  PrivatePathInPublicTree,
  ReachedInternals,
  TouchedJudge,
  Weakened,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Array, Effect, Option, Schema } from "effect";

import type { PushFacts } from "../src/facts.ts";
import { scan } from "../src/stages/shape.ts";
import {
  addedLines,
  ask,
  checkPath,
  configDir,
  modified,
  policy,
  testFacts,
  wire,
} from "./facts.ts";

const paths = (...each: readonly [string, ...string[]]) =>
  Array.map(each, (path) => RepoPath.make(path));

const at = (path: string, line: number) => ({
  line,
  path: RepoPath.make(path),
});

const week = "packages/parse/src/week.ts";

const weekTest = "packages/parse/test/week.test.ts";

const layerHolds = (...each: readonly string[]): ReadonlySet<RepoPath> =>
  new Set(each.map((path) => RepoPath.make(path)));

const push = (
  files: readonly string[],
  lines: readonly (readonly [string, number, string])[] = [],
  overrides: Partial<PushFacts> = {}
) =>
  testFacts({
    addedLines: addedLines(...lines),
    changes: modified(...files),
    ...overrides,
  });

const everyProblem = push(
  [week, "docs/guide.md", ".github/workflows/ci.yml"],
  [
    [week, 1, 'export { pad } from "../../format/src/pad";'],
    [week, 4, "// @ts-ignore"],
    [week, 9, "it.only("],
  ],
  { layerPaths: new Set([RepoPath.make("docs/guide.md")]) }
);

// The language service reads its directive anywhere in a source file, so
// the marker is joined at run time.
const effectDiagnostics = ["@effect", "-diagnostics"].join("");

const [moduleA, moduleB] = Schema.decodeSync(
  Schema.Tuple([Territory, Territory])
)([
  {
    module: "a",
    paths: ["packages/a/**"],
    publicFiles: ["packages/a/src/index.ts"],
  },
  {
    module: "b",
    paths: ["packages/b/**"],
    publicFiles: ["packages/b/src/index.ts"],
  },
]);

const x = "packages/a/src/x.ts";

const xTest = "packages/a/test/x.test.ts";

const pushToA = (
  files: readonly string[],
  lines: readonly (readonly [string, number, string])[] = []
) =>
  push(files, lines, {
    ask: Option.some({ ...ask, territory: moduleA }),
    policy: {
      ...policy,
      judge: {
        ...policy.judge,
        paths: [...policy.judge.paths, Glob.make("oxlint.config.*")],
      },
      modules: [moduleA, moduleB],
    },
  });

const markerLines: readonly (readonly [string, string])[] = [
  [".skip(", '  it.skip("parses week 53", () => {'],
  [".only(", '  describe.only("weeks", () => {'],
  [".todo(", '  it.todo("parses week 54");'],
  ["eslint-disable", "/* eslint-disable no-console */"],
  ["oxlint-disable", "// oxlint-disable-next-line no-explicit-any"],
  ["biome-ignore", "// biome-ignore lint/style: generated"],
  ["@ts-ignore", "// @ts-ignore"],
  ["@ts-expect-error", "// @ts-expect-error"],
  ["@ts-nocheck", "// @ts-nocheck"],
  [effectDiagnostics, `// ${effectDiagnostics} floatingEffect:off`],
  ["# noqa", "import os  # noqa"],
  ["# type: ignore", "x = parse(y)  # type: ignore"],
  ["#[allow(", "#[allow(dead_code)]"],
  ["//nolint", "func parse() { //nolint"],
  ["istanbul ignore", "/* istanbul ignore next */"],
  ["c8 ignore", "/* c8 ignore next */"],
];

const pad = "../../format/src/pad.ts";

const reachedFromWeek = (line: number, to: string) =>
  new ReachedInternals({ at: at(week, line), from: RepoPath.make(week), to });

const rows: readonly {
  readonly name: string;
  readonly facts: PushFacts;
  readonly refusals: readonly Refusal[];
}[] = [
  { facts: push([week]), name: "a change inside the territory", refusals: [] },
  {
    facts: push([week, "packages/format/src/pad.ts", "docs/guide.md"]),
    name: "changes outside the territory, every one named",
    refusals: [
      new OutOfScope({
        paths: paths("docs/guide.md", "packages/format/src/pad.ts"),
      }),
    ],
  },
  {
    facts: push([".github/workflows/ci.yml"]),
    name: "a change to a CI workflow",
    refusals: [new TouchedJudge({ paths: paths(".github/workflows/ci.yml") })],
  },
  {
    facts: push([`${configDir}/project.ts`]),
    name: "a change to the config folder",
    refusals: [new TouchedJudge({ paths: paths(`${configDir}/project.ts`) })],
  },
  {
    facts: push(["vitest.config.ts", "packages/parse/vitest.config.ts"]),
    name: "a change to a test runner's config, at the root or in the territory",
    refusals: [
      new TouchedJudge({
        paths: paths("packages/parse/vitest.config.ts", "vitest.config.ts"),
      }),
    ],
  },
  {
    facts: push([".env.production", "apps/web/.env.production.local"]),
    name: "a committed env file is judged, and a local one is only out of scope",
    refusals: [
      new OutOfScope({ paths: paths("apps/web/.env.production.local") }),
      new TouchedJudge({ paths: paths(".env.production") }),
    ],
  },
  {
    facts: push(["packages/format/package.json"]),
    name: "the territory's root manifest is no other package's manifest",
    refusals: [
      new OutOfScope({ paths: paths("packages/format/package.json") }),
    ],
  },
  {
    facts: push(["package.json"]),
    name: "a change to package.json's dependencies only",
    refusals: [],
  },
  {
    facts: push(["package.json"], [], { scriptsChanged: true }),
    name: "a change to package.json's scripts",
    refusals: [new TouchedJudge({ paths: paths("package.json#/scripts") })],
  },
  {
    facts: push([checkPath]),
    name: "an answer's change to its own ask's check, inside the territory",
    refusals: [new TouchedJudge({ paths: paths(checkPath) })],
  },
  {
    facts: push([ask.file, checkPath], [], { opensAsk: true }),
    name: "a maintainer opening the ask writes its file and its check",
    refusals: [],
  },
  {
    facts: push([ask.file, `${configDir}/project.ts`], [], { opensAsk: true }),
    name: "opening an ask still may not touch the rest of the judge",
    refusals: [new TouchedJudge({ paths: paths(`${configDir}/project.ts`) })],
  },
  {
    facts: push(
      [weekTest],
      [[weekTest, 12, '  it.skip("parses week 53", () => {']]
    ),
    name: "an added .skip( with no reason",
    refusals: [
      new Weakened({ at: at(weekTest, 12), weakening: { marker: ".skip(" } }),
    ],
  },
  {
    facts: push(
      [week],
      [[week, 7, "// oxlint-disable-next-line no-x -- reason given"]]
    ),
    name: "an added escape with a reason (counted by escapeDecisions)",
    refusals: [],
  },
  {
    facts: push([weekTest], [[weekTest, 2, 'vi.mock("../src/week.ts");']], {
      policy: { ...policy, weakening: { markers: ["vi.mock("] } },
    }),
    name: "a marker the project adds to the defaults",
    refusals: [
      new Weakened({ at: at(weekTest, 2), weakening: { marker: "vi.mock(" } }),
    ],
  },
  {
    facts: push([week], [], {
      layerPaths: new Set([RepoPath.make(week)]),
    }),
    name: "a path a layer holds",
    refusals: [new PrivatePathInPublicTree({ paths: paths(week) })],
  },
  {
    facts: push([week, weekTest], [], { layerPaths: layerHolds(weekTest) }),
    name: "a path a layer holds, pushed by someone who reads no layer: every path they wrote, not which collide",
    refusals: [new PrivatePathInPublicTree({ paths: paths(week, weekTest) })],
  },
  {
    facts: push([week, weekTest], [], {
      canReadLayers: false,
      layerPaths: layerHolds(weekTest),
    }),
    name: "a path a layer holds, pushed by someone told they read no layer: every path they wrote",
    refusals: [new PrivatePathInPublicTree({ paths: paths(week, weekTest) })],
  },
  {
    facts: push([week, weekTest], [], {
      canReadLayers: true,
      layerPaths: layerHolds(weekTest),
    }),
    name: "a path a layer holds, pushed by someone who reads the layers: only the path that collides",
    refusals: [new PrivatePathInPublicTree({ paths: paths(weekTest) })],
  },
  {
    facts: push([week, weekTest], [], {
      layerPaths: layerHolds("packages/parse/test"),
    }),
    name: "a path under a folder a layer holds, pushed by someone who reads no layer: every path they wrote",
    refusals: [new PrivatePathInPublicTree({ paths: paths(week, weekTest) })],
  },
  {
    facts: push([week, weekTest], [], {
      canReadLayers: true,
      layerPaths: layerHolds("packages/parse/test"),
    }),
    name: "a path under a folder a layer holds, pushed by someone who reads the layers: only the path under it",
    refusals: [new PrivatePathInPublicTree({ paths: paths(weekTest) })],
  },
  {
    facts: push([week, weekTest], [], {
      layerPaths: layerHolds("packages/parse/tes", "packages/parse/test/week"),
    }),
    name: "a layer path that only begins a path's name holds no path",
    refusals: [],
  },
  {
    facts: push([week], [], { layerPaths: layerHolds(weekTest) }),
    name: "a push by someone who reads no layer, with nothing in a layer, is not refused",
    refusals: [],
  },
  {
    facts: testFacts({
      changes: [
        { path: RepoPath.make(week), status: "added" },
        { path: RepoPath.make(weekTest), status: "deleted" },
      ],
      layerPaths: layerHolds(weekTest),
    }),
    name: "deleting a path a layer holds writes nothing into the public tree",
    refusals: [],
  },
  {
    facts: testFacts({
      changes: [
        { path: RepoPath.make(week), status: "added" },
        { path: RepoPath.make(weekTest), status: "modified" },
        { path: RepoPath.make("packages/parse/src/old.ts"), status: "deleted" },
      ],
      layerPaths: layerHolds(weekTest),
    }),
    name: "to someone who reads no layer, every path added or modified, never one deleted",
    refusals: [new PrivatePathInPublicTree({ paths: paths(week, weekTest) })],
  },
  {
    facts: push(
      [week],
      [[week, 1, 'import { pad } from "../../format/src/pad.ts";']]
    ),
    name: "an import of another module's internal file",
    refusals: [
      new ReachedInternals({
        at: at(week, 1),
        from: RepoPath.make(week),
        to: "../../format/src/pad.ts",
      }),
    ],
  },
  {
    facts: push(
      [week],
      [
        [week, 1, "import {"],
        [week, 2, "  pad,"],
        [week, 3, '  trim } from "../../format/src/pad.ts";'],
      ]
    ),
    name: "an import of another module's internal file, over several lines",
    refusals: [
      new ReachedInternals({
        at: at(week, 3),
        from: RepoPath.make(week),
        to: "../../format/src/pad.ts",
      }),
    ],
  },
  {
    facts: push(
      [week],
      [[week, 1, 'export * from "../../format/src/pad.ts";']]
    ),
    name: "a re-export of another module's internal file",
    refusals: [
      new ReachedInternals({
        at: at(week, 1),
        from: RepoPath.make(week),
        to: "../../format/src/pad.ts",
      }),
    ],
  },
  {
    facts: push(
      [week],
      [
        [week, 1, 'import { pad } from "../../format/src/index.ts";'],
        [week, 2, 'import { lex } from "./lex.ts";'],
        [week, 3, 'import { Array, Effect, Option, Schema } from "effect";'],
      ]
    ),
    name: "imports of another module's public file, its own files and a package",
    refusals: [],
  },
  {
    facts: pushToA(
      [x],
      [[x, 12, `// ${effectDiagnostics} floatingEffect:off`]]
    ),
    name: "an added Effect diagnostics directive with no reason",
    refusals: [
      new Weakened({
        at: at(x, 12),
        weakening: { marker: effectDiagnostics },
      }),
    ],
  },
  {
    facts: pushToA(
      [x],
      [
        [
          x,
          12,
          `// ${effectDiagnostics} floatingEffect:off -- the Worker's fetch is the one HTTP client`,
        ],
      ]
    ),
    name: "an added Effect diagnostics directive with a reason",
    refusals: [],
  },
  {
    facts: pushToA(
      ["packages/b/src/y.ts", xTest, "oxlint.config.ts", x],
      [
        [xTest, 9, '  it.only("reads y", () => {'],
        [x, 1, 'import { y } from "../../b/src/internal.ts";'],
        [xTest, 3, '  it.skip("reads x", () => {'],
      ]
    ),
    name: "a push out of scope, touching the judge, weakening twice and reaching into internals, all at once",
    refusals: [
      new OutOfScope({ paths: paths("packages/b/src/y.ts") }),
      new TouchedJudge({ paths: paths("oxlint.config.ts") }),
      new Weakened({ at: at(xTest, 3), weakening: { marker: ".skip(" } }),
      new Weakened({ at: at(xTest, 9), weakening: { marker: ".only(" } }),
      new ReachedInternals({
        at: at(x, 1),
        from: RepoPath.make(x),
        to: "../../b/src/internal.ts",
      }),
    ],
  },
  ...markerLines.map(([marker, text]) => ({
    facts: push([week], [[week, 5, text]]),
    name: `the default marker ${marker}`,
    refusals: [new Weakened({ at: at(week, 5), weakening: { marker } })],
  })),
  {
    facts: push(
      ["packages/parse/README.md"],
      [["packages/parse/README.md", 40, 'Focus one test with `it.only("…")`.']]
    ),
    name: "a marker inside a string in a README",
    refusals: [
      new Weakened({
        at: at("packages/parse/README.md", 40),
        weakening: { marker: ".only(" },
      }),
    ],
  },
  {
    facts: push(
      [week],
      [
        [week, 2, `const pad = await import("${pad}");`],
        [week, 6, `const { trim } = require("${pad}");`],
      ]
    ),
    name: "a dynamic import and a require of another module's internal file",
    refusals: [reachedFromWeek(2, pad), reachedFromWeek(6, pad)],
  },
  {
    facts: push([week], [[week, 4, `const pad = await import(\`${pad}\`);`]]),
    name: "a dynamic import of another module's internal file, its specifier a template",
    refusals: [reachedFromWeek(4, pad)],
  },
  {
    facts: push(
      [week],
      [
        [
          week,
          1,
          `import a from "../../format/src/a.ts"; import b from "${pad}";`,
        ],
      ]
    ),
    name: "two imports of internal files on one line",
    refusals: [
      reachedFromWeek(1, "../../format/src/a.ts"),
      reachedFromWeek(1, pad),
    ],
  },
  {
    facts: push(
      [week],
      [[week, 1, 'import { pad } from "@datekit/format/src/pad";']]
    ),
    name: "a package subpath into another module's src folder",
    refusals: [reachedFromWeek(1, "@datekit/format/src/pad")],
  },
  {
    facts: push(
      [week, "packages/parse/README.md"],
      [
        [week, 1, `// import { pad } from "${pad}";`],
        [week, 2, 'import { pad } from "../../format";'],
        [week, 3, 'import { trim } from "@datekit/format";'],
        ["packages/parse/README.md", 1, `import { pad } from "${pad}";`],
      ]
    ),
    name: "an import in a comment, of a module's root or package, or in prose",
    refusals: [],
  },
  {
    facts: everyProblem,
    name: "every shape problem at once",
    refusals: [
      new OutOfScope({ paths: paths("docs/guide.md") }),
      new TouchedJudge({ paths: paths(".github/workflows/ci.yml") }),
      new Weakened({ at: at(week, 4), weakening: { marker: "@ts-ignore" } }),
      new Weakened({ at: at(week, 9), weakening: { marker: ".only(" } }),
      // bob reads no layer, so he hears every path he wrote.
      new PrivatePathInPublicTree({
        paths: paths(".github/workflows/ci.yml", "docs/guide.md", week),
      }),
      new ReachedInternals({
        at: at(week, 1),
        from: RepoPath.make(week),
        to: "../../format/src/pad",
      }),
    ],
  },
];

describe("shape: every problem a push's changes have", () => {
  it.effect.each(rows)("$name", ({ facts, refusals }) =>
    Effect.gen(function* () {
      const found = yield* scan.run(facts);

      expect(wire(found)).toStrictEqual(wire(refusals));
    })
  );

  it.effect("reports in the order of the union's Shape group", () =>
    Effect.gen(function* () {
      const found = yield* scan.run(everyProblem);

      const order = groups
        .find((group) => group.name === "Shape")
        ?.members.map((member) => member.identifier);

      expect([...new Set(found.map((refusal) => refusal._tag))]).toStrictEqual(
        order
      );
    })
  );
});
