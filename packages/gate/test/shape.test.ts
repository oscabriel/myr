import { describe, expect, it } from "@effect/vitest";
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
import { Array, Effect } from "effect";

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

/** A push that changes `files` and adds `lines` to them. */
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

/** One push with every problem shape knows. */
const everyProblem = push(
  [week, "docs/guide.md", ".github/workflows/ci.yml"],
  [
    [week, 1, 'export { pad } from "../../format/src/pad";'],
    [week, 4, "// @ts-ignore"],
    [week, 9, "it.only("],
  ],
  { layerPaths: new Set([RepoPath.make("docs/guide.md")]) }
);

// Each row is one push. Shape reports every problem the push has, in the
// order of the refusal union's Shape group.
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
    name: "a decider opening the ask writes its file and its check",
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
    name: "an added escape with a reason (counted by the ratchet stage)",
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
        [week, 1, 'import { pad } from "../../format/src/index.ts";'],
        [week, 2, 'import { lex } from "./lex.ts";'],
        [week, 3, 'import { Array, Effect } from "effect";'],
      ]
    ),
    name: "imports of another module's public file, its own files and a package",
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
      new PrivatePathInPublicTree({ paths: paths("docs/guide.md") }),
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
