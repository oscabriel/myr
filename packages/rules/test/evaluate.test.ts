import { NodeServices } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Policy } from "@repo/protocol/domain/policy";
import type { VisibilityPolicy } from "@repo/protocol/domain/visibility";
import { RepoPath } from "@repo/protocol/ids";
import { ClaimantFacts, ProposalFacts } from "@repo/sdk";
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

const decodeProposal = Schema.decodeUnknownSync(ProposalFacts);

const decodeClaimant = Schema.decodeUnknownSync(ClaimantFacts);

const fixBugProposal = {
  kind: "fixBug",
  proposer: "carol",
  territory: "@datekit/parse",
};

const redThenGreen = (path: string) =>
  CheckSpec.cases.RedThenGreen.make({ path: RepoPath.make(path) });

const opened = {
  openedAt: now,
  openedIn: at,
  project: "oscabriel/datekit",
  state: "open",
};

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

const judgeFor = (test: string) => ({
  paths: [`${configFolder}/**`, ".github/workflows/ci.yml"],
  pointers: ["package.json#/scripts", `test:${test}`],
});

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
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [
    { handles: ["priya"], paths: "packages/parse/src/public/**" },
    { handles: ["olivia"], paths: "**" },
  ],
  decisions: { expireDays: 14 },
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
  caps: { claimsPerPerson: 20, proposalsPerPerson: 20 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [{ handles: ["olivia"], paths: "**" }],
  decisions: { expireDays: 7 },
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

const defaultsEncoded = {
  ...fromFacts,
  agents: "trailer",
  asks: [],
  caps: { claimsPerPerson: 20, proposalsPerPerson: 20 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [{ handles: ["olivia"], paths: "**" }],
  decisions: { expireDays: 14 },
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
      requires: ["want", "check", "territory"],
      strength: "assertion",
    },
  ],
  ratchets: [],
  record: { countsAfterDays: 30, windowDays: 365 },
  run: foundRun,
  source: "defaults",
  vouch: { file: defaultVouchFile, mode: "forCode" },
  // The gate scans its own default markers plus these, a project's own.
  weakening: { markers: [] },
};

const evaluated = (modules: ConfigBundle) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;
    const policy = yield* evaluator.evaluate({ at, facts, modules });

    return yield* Schema.encodeEffect(Policy)(policy);
  });

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

const visibilityEncoded = {
  checks: {
    admit: { greenOnMainRuns: 3, redOnKnownBadAtLeast: 1 },
    areas: { parse: "packages/parse/**" },
    attempts: { perClaim: 3, perPersonPerAreaPerWeek: 10 },
    canary: false,
    commit: "salted-sha256-merkle",
    layer: "maintainers",
    pin: "claim",
    result: "area-bit",
  },
  env: { setters: "deciders" },
  flows: { noWriteDown: true, release: "deciders" },
  layers: [
    {
      audience: "maintainers",
      disclose: "sealed",
      holds: ["checks"],
      name: "maintainers",
      readers: "deciders",
      reason: "Held-back checks for the parser",
      writers: "deciders",
    },
  ],
  notice: { narrowingDays: 7 },
} satisfies typeof VisibilityPolicy.Encoded;

const exporting = (data: Schema.Json) =>
  `export default ${JSON.stringify(data)};\n`;

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

  it.live(
    "reads visibility.ts into the policy's visibility, beside the project module or without one",
    () =>
      Effect.gen(function* () {
        const project = yield* baseProject;

        const beside = yield* evaluated(
          bundleOf({
            "project.ts": project,
            "visibility.ts": exporting(visibilityEncoded),
          })
        );

        const alone = yield* evaluated(
          bundleOf({ "visibility.ts": exporting(visibilityEncoded) })
        );

        const without = yield* evaluated(bundleOf({ "project.ts": project }));

        expect([
          beside.visibility,
          alone.visibility,
          without.visibility,
        ]).toStrictEqual([visibilityEncoded, visibilityEncoded, undefined]);
        expect(alone.source).toBe("config");
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("names a visibility.ts that states no visibility", () =>
    Effect.gen(function* () {
      const project = yield* baseProject;

      const failures = yield* Effect.forEach(
        ["export const nothing = 1;\n", exporting({ layers: "maintainers" })],
        (visibility) =>
          failed(
            bundleOf({ "project.ts": project, "visibility.ts": visibility })
          )
      );

      expect(
        failures.map(({ detail, reason }) => ({
          names: detail.includes(`${configFolder}/visibility.ts`),
          reason,
        }))
      ).toStrictEqual([
        { names: true, reason: "decode" },
        { names: true, reason: "decode" },
      ]);
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

  it.live("runs config code with no env beyond PATH, and no fetch", () =>
    Effect.gen(function* () {
      const base = yield* baseProject;

      const project = [
        base.replace("export default ", "const base = "),
        "const seen = [...Object.keys(process.env).toSorted(), typeof fetch];",
        "export default { ...base, weakening: { markers: seen } };",
      ].join("\n");

      const policy = yield* evaluated(bundleOf({ "project.ts": project }));

      expect(policy.weakening).toStrictEqual({
        markers: ["PATH", "undefined"],
      });
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("keeps only the end of a config's endless output", () =>
    Effect.gen(function* () {
      const failure = yield* failed(
        bundleOf({
          "project.ts": [
            'const flood = "x".repeat(8 * 1024 * 1024) + "the end";',
            "await new Promise((done) => process.stderr.write(flood, done));",
            "process.exit(3);",
          ].join("\n"),
        })
      );

      expect(failure.detail.length).toBeLessThanOrEqual(64 * 1024);
      expect(failure.detail).toMatch(/x+the end$/u);
    }).pipe(Effect.provide(bunEvaluator()))
  );

  // A project written with the real sdk: the rules ride under its symbol,
  // and the facts are the sdk's own fact schemas.
  const sdkProject = bundleOf({
    "project.ts": [
      'import { check, kind, kinds, project } from "@repo/sdk";',
      "",
      "const trusted = kind({",
      "  args: {},",
      '  check: () => check.redThenGreen("test/trusted.test.ts"),',
      '  checkKind: "redThenGreen",',
      '  name: "trusted",',
      "  opensAlone: (proposal) => proposal.record >= 3,",
      "});",
      "",
      "export default project({",
      "  admit: (claimant) => claimant.vouched || claimant.record > 0,",
      "  kinds: [kinds.fix, trusted],",
      "});",
    ].join("\n"),
  });

  it.live("calls the rules a project written with the sdk carries", () =>
    Effect.gen(function* () {
      const evaluator = yield* RulesEvaluator;
      const modules = sdkProject;

      const proposal = (kind: string, record: number) =>
        evaluator.call({
          at,
          facts: decodeProposal({
            kind,
            proposer: "carol",
            record,
            territory: ".",
          }),
          modules,
          rule: "opensAlone",
        });

      const claimant = (vouched: boolean, record: number) =>
        evaluator.call({
          at,
          facts: decodeClaimant({
            handle: "bram",
            kind: "fix",
            record,
            territory: ".",
            vouched,
          }),
          modules,
          rule: "admit",
        });

      expect([
        yield* proposal("trusted", 3),
        yield* proposal("trusted", 2),
        yield* proposal("fix", 9),
        yield* claimant(true, 0),
        yield* claimant(false, 1),
        yield* claimant(false, 0),
      ]).toStrictEqual([true, false, false, true, true, false]);
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live(
    "evaluates a project file that states nothing as no folder at all",
    () =>
      Effect.gen(function* () {
        const stated = yield* evaluated(
          bundleOf({
            "project.ts": [
              'import { project } from "@repo/sdk";',
              "",
              "export default project({});",
            ].join("\n"),
          })
        );

        expect(stated).toStrictEqual({ ...defaultsEncoded, source: "config" });
      }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("calls a function-valued rule with the facts it is given", () =>
    Effect.gen(function* () {
      const evaluator = yield* RulesEvaluator;
      const modules = yield* folder("cm");

      const opensAlone = (record: number) =>
        evaluator.call({
          at,
          facts: decodeProposal({ ...fixBugProposal, record }),
          modules,
          rule: "opensAlone",
        });

      const admit = evaluator.call({
        at,
        facts: decodeClaimant({
          handle: "bram",
          kind: "fixBug",
          record: 3,
          territory: "@datekit/parse",
          vouched: true,
        }),
        modules,
        rule: "admit",
      });

      expect([
        yield* opensAlone(3),
        yield* opensAlone(1),
        yield* admit,
      ]).toStrictEqual([true, false, false]);
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

  it.live(
    "gives the defaults, from the folder, when there is no policy.json",
    () =>
      Effect.gen(function* () {
        expect(yield* evaluated(yield* folder("cm"))).toStrictEqual({
          ...defaultsEncoded,
          source: "config",
        });
      }).pipe(Effect.provide(jsonEvaluator))
  );

  it.live("gives the defaults to a project with no config folder", () =>
    Effect.gen(function* () {
      expect(yield* evaluated(bundleOf({}))).toStrictEqual(defaultsEncoded);
    }).pipe(Effect.provide(jsonEvaluator))
  );

  it.live("agrees with /bun on a folder that holds no policy", () =>
    Effect.gen(function* () {
      const modules = bundleOf({ "vouched.td": "priya\n" });
      const fromJson = yield* evaluated(modules);

      const fromBun = yield* evaluated(modules).pipe(
        Effect.provide(bunEvaluator())
      );

      expect(fromJson).toStrictEqual({ ...defaultsEncoded, source: "config" });
      expect(fromBun).toStrictEqual(fromJson);
    }).pipe(Effect.provide(jsonEvaluator))
  );

  it.live("has no function-valued rules to call", () =>
    Effect.gen(function* () {
      const evaluator = yield* RulesEvaluator;

      const called = yield* evaluator.call({
        at,
        facts: decodeProposal({ ...fixBugProposal, record: 3 }),
        modules: yield* folder("cm"),
        rule: "opensAlone",
      });

      expect(called).toBeFalsy();
    }).pipe(Effect.provide(jsonEvaluator))
  );
});
