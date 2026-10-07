import { NodeServices } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Policy } from "@repo/protocol/domain/policy";
import { RepoPath } from "@repo/protocol/ids";
import { Duration, Effect, Layer, Result, Schema } from "effect";

import { Finishers } from "../src/finish.ts";
import { RulesEvaluator } from "../src/rules-evaluator.ts";
import type { ConfigBundle } from "../src/rules-evaluator.ts";
import { RulesEvaluatorJson } from "../src/rules-evaluator/json.ts";
import {
  at,
  baseProject,
  bundleOf,
  bunEvaluator,
  configFolder,
  defaultVouchFile,
  facts,
  finishers,
  folder,
  now,
} from "./world.ts";

/** A red-then-green check on one file, as `CheckSpec` encodes it. */
const redThenGreen = (path: string) =>
  CheckSpec.cases.RedThenGreen.make({ path: RepoPath.make(path) });

/** What the platform fills in on every ask: when, where and whose. */
const opened = {
  openedAt: now,
  openedIn: at,
  project: "datekit",
  state: "open",
};

/** What every policy in these tests derives from the shared facts. */
const fromFacts = {
  at,
  modules: [
    {
      module: "@datekit/parse",
      paths: ["packages/parse/**"],
      publicFiles: ["packages/parse/src/index.ts"],
    },
    { module: "@datekit/format", paths: ["packages/format/**"] },
  ],
  vouches: [
    { denounced: false, handle: "priya" },
    { denounced: true, handle: "mallory", note: "Spam" },
  ],
};

/** The judge closure the fake finishers give for a run block's test command. */
const judgeFor = (test: string) => ({
  paths: [`${configFolder}/**`, ".github/workflows/ci.yml"],
  pointers: ["package.json#/scripts", `test:${test}`],
});

/** The run block the fake finder finds in CI. */
const foundRun = { checks: { unit: "bun test" }, test: "bun test {path}" };

const fixBug = {
  checkKind: "redThenGreen",
  claimers: { record: { area: "packages/parse", atLeast: 1 } },
  finish: "optional",
  name: "fixBug",
  oneWay: false,
  race: 1,
  requires: ["want", "check"],
  strength: "assertion",
};

/** The convex-merged example's policy, as `Policy` encodes it. */
const exampleEncoded = {
  ...fromFacts,
  agents: "trailer",
  asks: [
    {
      ...opened,
      askedBy: "priya",
      blockedBy: [],
      brief: { want: "Parse ISO week dates such as 2026-W40-6" },
      check: redThenGreen("packages/parse/test/iso-week.repro.test.ts"),
      file: `${configFolder}/asks/iso-week.ask.ts`,
      id: "iso-week",
      kind: "fixBug",
      mentor: "priya",
      reserve: "newcomers",
      territory: { module: "@datekit/parse", paths: ["packages/parse/**"] },
    },
    {
      ...opened,
      askedBy: "olivia",
      blockedBy: [],
      brief: {
        context: ["February 29 exists only in leap years"],
        want: "Reject February 29 in a year that is not a leap year",
      },
      check: redThenGreen("packages/parse/test/leap-year.repro.test.ts"),
      file: `${configFolder}/asks/leap-year.ask.ts`,
      id: "leap-year",
      kind: "fixBug",
      territory: { module: "@datekit/parse", paths: ["packages/parse/**"] },
    },
  ],
  budget: { decisionsPerDay: 5, expireDays: 14 },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [
    { handles: ["priya"], paths: "packages/parse/src/public/**" },
    { handles: ["olivia"], paths: "**" },
  ],
  functions: { admit: false, opensAlone: true },
  judge: judgeFor("bun test {path}"),
  kinds: [fixBug],
  ratchets: [],
  record: { countsAfterDays: 30, windowDays: 365 },
  run: foundRun,
  source: "config",
  vouch: { file: defaultVouchFile, mode: "forCode" },
  weakening: { markers: [".skip(", ".only("] },
};

/** The policy a folder holding only `policy.json` states. */
const jsonEncoded = {
  ...fromFacts,
  agents: "none",
  asks: [
    {
      ...opened,
      askedBy: "olivia",
      blockedBy: [],
      brief: { want: "Format durations as ISO 8601" },
      check: redThenGreen("test/duration.repro.test.ts"),
      file: "policy.json",
      id: "iso-duration",
      kind: "fix",
      territory: { module: ".", paths: ["**"] },
    },
  ],
  budget: { decisionsPerDay: 3, expireDays: 7 },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [{ handles: ["olivia"], paths: "**" }],
  functions: { admit: false, opensAlone: false },
  judge: judgeFor("npx vitest run {path}"),
  kinds: [
    {
      checkKind: "redThenGreen",
      claimers: "anyone",
      finish: "never",
      name: "fix",
      oneWay: false,
      race: 1,
      requires: ["want", "check"],
      strength: "assertion",
    },
  ],
  ratchets: [],
  record: { countsAfterDays: 30, windowDays: 365 },
  run: {
    checks: { lint: "npm run lint" },
    setup: "npm ci --ignore-scripts",
    test: "npx vitest run {path}",
  },
  source: "config",
  vouch: { file: defaultVouchFile, mode: "forCode" },
  weakening: { markers: [".skip("] },
};

/**
 * The defaults (convex-merged design §3, "no folder means defaults"; the
 * weakening markers from spec §4.2), as `Policy` encodes them.
 */
const defaultsEncoded = {
  ...fromFacts,
  agents: "trailer",
  asks: [],
  budget: { decisionsPerDay: 5, expireDays: 14 },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [{ handles: ["olivia"], paths: "**" }],
  functions: { admit: false, opensAlone: false },
  judge: judgeFor("bun test {path}"),
  kinds: [
    {
      checkKind: "redThenGreen",
      claimers: "vouched",
      finish: "optional",
      name: "fix",
      oneWay: false,
      race: 1,
      requires: ["want", "check"],
      strength: "assertion",
    },
  ],
  ratchets: [],
  record: { countsAfterDays: 30, windowDays: 365 },
  run: foundRun,
  source: "defaults",
  vouch: { file: defaultVouchFile, mode: "forCode" },
  weakening: {
    markers: [
      ".skip(",
      ".only(",
      ".todo(",
      "eslint-disable",
      "oxlint-disable",
      "biome-ignore",
      "@ts-ignore",
      "@ts-expect-error",
      "@ts-nocheck",
      // The Effect language service would read the whole word as a directive.
      ["@effect", "diagnostics"].join("-"),
      "# noqa",
      "# type: ignore",
      "#[allow(",
      "//nolint",
      "istanbul ignore",
      "c8 ignore",
    ],
  },
};

/** Evaluates a bundle at `at` with the shared facts, and encodes the policy. */
const evaluated = (modules: ConfigBundle) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;
    const policy = yield* evaluator.evaluate({ at, facts, modules });

    return yield* Schema.encodeEffect(Policy)(policy);
  });

/** Evaluates a bundle that must fail, and hands back its `RulesFailed`. */
const failed = (modules: ConfigBundle) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;

    const result = yield* Effect.result(
      evaluator.evaluate({ at, facts, modules })
    );

    if (Result.isSuccess(result)) {
      return assert.fail("the config evaluated to a policy");
    }

    return result.failure;
  });

/** An ask file whose brief says what happens today, but not what is wanted. */
const noWant = `export default ${JSON.stringify({
  blockedBy: [],
  brief: { current: "Dates parse only in one format" },
  check: redThenGreen("test/formats.repro.test.ts"),
  kind: "fix",
  territory: { module: ".", paths: ["**"] },
})};\n`;

describe("the /bun adapter", () => {
  it.live("evaluates the example's config folder to its policy", () =>
    Effect.gen(function* () {
      expect(yield* evaluated(yield* folder("cm"))).toStrictEqual(
        exampleEncoded
      );
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("reads a folder that holds only policy.json", () =>
    Effect.gen(function* () {
      expect(yield* evaluated(yield* folder("json-only"))).toStrictEqual(
        jsonEncoded
      );
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live(
    "adds ask files to the policy.json that stands in for project.ts",
    () =>
      Effect.gen(function* () {
        const json = yield* folder("json-only");
        const example = yield* folder("cm");

        const askFiles = Object.entries(example.modules).filter(([path]) =>
          path.startsWith(`${configFolder}/asks/`)
        );

        const policy = yield* evaluated({
          ...json,
          modules: { ...json.modules, ...Object.fromEntries(askFiles) },
        });

        expect(policy.asks.map(({ id }) => id)).toStrictEqual([
          "iso-duration",
          "iso-week",
          "leap-year",
        ]);
        expect(policy.run).toStrictEqual(jsonEncoded.run);
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("gives the defaults to a project with no config folder", () =>
    Effect.gen(function* () {
      expect(yield* evaluated(bundleOf({}))).toStrictEqual(defaultsEncoded);
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("fails to load a config with a syntax error", () =>
    Effect.gen(function* () {
      const failure = yield* failed(
        bundleOf({ "project.ts": "export default {\n" })
      );

      expect(failure.reason).toBe("load");
      expect(failure.detail).toContain(`${configFolder}/project.ts`);
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("names the ask file whose ask has no want", () =>
    Effect.gen(function* () {
      const failure = yield* failed(
        bundleOf({
          "asks/formats.ask.ts": noWant,
          "project.ts": yield* baseProject,
        })
      );

      expect(failure.reason).toBe("decode");
      expect(failure.detail).toContain(`${configFolder}/asks/formats.ask.ts`);
      expect(failure.detail).toContain("want");
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("stops a config that loops forever at its time limit", () =>
    Effect.gen(function* () {
      const [took, failure] = yield* Effect.timed(
        failed(bundleOf({ "project.ts": "for (;;) {}\nexport default {};\n" }))
      );

      expect(failure.reason).toBe("timeout");
      expect(Duration.toMillis(took)).toBeLessThan(5000);
    }).pipe(Effect.provide(bunEvaluator({ timeout: "1 second" })))
  );

  it.live("reports a config whose code throws", () =>
    Effect.gen(function* () {
      const failure = yield* failed(
        bundleOf({ "project.ts": 'throw new Error("no policy today");\n' })
      );

      expect(failure.reason).toBe("threw");
      expect(failure.detail).toContain("no policy today");
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("refuses a run block the finder finds without a test command", () =>
    Effect.gen(function* () {
      const failure = yield* failed(yield* folder("cm"));

      expect(failure.reason).toBe("decode");
      expect(failure.detail).toContain("run block");
      expect(failure.detail).toContain(".github/workflows/ci.yml");
    }).pipe(
      Effect.provide(
        bunEvaluator(
          {},
          Finishers.of({
            ...finishers,
            findRunBlock: (files) => ({
              run: { checks: {} },
              sources: files.map(({ path }) => path),
            }),
          })
        )
      )
    )
  );

  it.live("points both names of the sdk at the one sdk module", () =>
    Effect.gen(function* () {
      const base = yield* baseProject;

      const project = [
        'import { marker } from "@repo/sdk";',
        'import { marker as same } from "@some-scope/cli/rules";',
        base.replace("export default ", "const base = "),
        "export default { ...base, weakening: { markers: [marker, same] } };",
      ].join("\n");

      const policy = yield* evaluated(bundleOf({ "project.ts": project }));

      expect(policy.weakening).toStrictEqual({
        markers: ["the sdk", "the sdk"],
      });
    }).pipe(
      Effect.provide(
        bunEvaluator({ sdk: `${import.meta.dirname}/fixtures/sdk-stub.ts` })
      )
    )
  );

  it.live("calls a function-valued rule with the facts it is given", () =>
    Effect.gen(function* () {
      const evaluator = yield* RulesEvaluator;
      const modules = yield* folder("cm");

      const call = (rule: "admit" | "opensAlone", held: number) =>
        evaluator.call({ at, facts: { held }, modules, rule });

      expect(yield* call("opensAlone", 3)).toBeTruthy();
      expect(yield* call("opensAlone", 1)).toBeFalsy();
      expect(yield* call("admit", 3)).toBeFalsy();
    }).pipe(Effect.provide(bunEvaluator()))
  );
});

describe("the /json adapter", () => {
  const jsonEvaluator = RulesEvaluatorJson.pipe(
    Layer.provide(Layer.succeed(Finishers, finishers)),
    Layer.provideMerge(NodeServices.layer)
  );

  it.live("reads the committed policy.json", () =>
    Effect.gen(function* () {
      expect(yield* evaluated(yield* folder("json-only"))).toStrictEqual(
        jsonEncoded
      );
    }).pipe(Effect.provide(jsonEvaluator))
  );

  it.live("gives the defaults when there is no policy.json", () =>
    Effect.gen(function* () {
      expect(yield* evaluated(yield* folder("cm"))).toStrictEqual(
        defaultsEncoded
      );
    }).pipe(Effect.provide(jsonEvaluator))
  );

  it.live("has no function-valued rules to call", () =>
    Effect.gen(function* () {
      const evaluator = yield* RulesEvaluator;

      const called = yield* evaluator.call({
        at,
        facts: { held: 3 },
        modules: yield* folder("cm"),
        rule: "opensAlone",
      });

      expect(called).toBeFalsy();
    }).pipe(Effect.provide(jsonEvaluator))
  );
});
