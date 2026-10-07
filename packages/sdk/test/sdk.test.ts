import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckSpec, RatchetMeasure } from "@repo/protocol/domain/check";
import { AskInput, FromCI, PolicyInput } from "@repo/protocol/domain/policy";
import { Schema } from "effect";

import {
  check,
  ClaimantFacts,
  defaults,
  functionsOf,
  kind,
  kinds,
  project,
  ProposalFacts,
  run,
  territory,
  toAskInput,
  toPolicyInput,
} from "../src/index.ts";

// Expected tagged values come from protocol's own constructors, never from
// the sdk under test.
const { LintToZero, Migrate, Ratchet, RedThenGreen } = CheckSpec.cases;

const redThenGreen = (path: string) =>
  RedThenGreen.make({ path: RedThenGreen.fields.path.make(path) });

// A name a migrate moves from or to: `from` and `to` share one schema.
const symbol = (name: string) => Migrate.fields.from.make(name);

const askFile = (id: string) => `${Brand.configDir}/asks/${id}.ask.ts`;

const decodePolicy = Schema.decodeSync(PolicyInput);

const decodeAsk = Schema.decodeSync(AskInput);

// The rules evaluator is handed facts as unknown JSON and decodes them so.
const decodeProposal = Schema.decodeUnknownSync(ProposalFacts);

const decodeClaimant = Schema.decodeUnknownSync(ClaimantFacts);

describe("the config folder's project file", () => {
  it("encodes the convex-merged example to policy data, with the run block found from CI", () => {
    const fixBug = kind({
      args: { repro: Schema.NonEmptyString, want: Schema.NonEmptyString },
      check: ({ repro }) => check.redThenGreen(repro),
      checkKind: "redThenGreen",
      claimers: { record: { area: "src/parser", atLeast: 1 } },
      name: "fixBug",
      opensAlone: (proposal) => proposal.record >= 3,
    });

    const definition = project({
      agents: "trailer",
      budget: { decisionsPerDay: 5, expire: "14 days" },
      caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
      deciders: { "**": "owners", "src/public/**": ["priya"] },
      kinds: [fixBug],
      record: { countsAfter: "30 days", window: "365 days" },
      vouch: "forCode",
    });

    const policy = decodePolicy(toPolicyInput(definition));

    expect(Schema.is(FromCI)(policy.run)).toBeTruthy();
    expect(policy).toStrictEqual({
      agents: "trailer",
      asks: [],
      budget: { decisionsPerDay: 5, expireDays: 14 },
      caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
      claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
      deciders: [
        { handles: "owners", paths: "**" },
        { handles: ["priya"], paths: "src/public/**" },
      ],
      functions: { admit: false, opensAlone: true },
      kinds: [
        {
          checkKind: "redThenGreen",
          claimers: { record: { area: "src/parser", atLeast: 1 } },
          finish: "optional",
          name: "fixBug",
          oneWay: false,
          race: 1,
          requires: ["want", "check", "territory"],
          strength: "assertion",
        },
      ],
      ratchets: [],
      record: { countsAfterDays: 30, windowDays: 365 },
      run: FromCI.make({}),
      source: "config",
      vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
      weakening: { markers: [] },
    });
  });

  it("encodes a datekit-shaped config with its own run block, keeping the {path} placeholder", () => {
    const definition = project({
      claims: { lapseAfter: "2 days", warnAfter: "3 hours" },
      deciders: { "**": ["ines-v"], "src/tz.ts": ["okonkwo"] },
      kinds: [kinds.fix, kinds.lintToZero, kinds.changeJudge],
      ratchets: {
        "bundle-kb": check.ratchet.metric("bun run size --json", {
          path: "/total",
        }),
        "no-explicit-any": {
          measure: check.ratchet.count("bun run lint --format json", {
            rule: "typescript/no-explicit-any",
          }),
          territory: "datekit",
        },
      },
      run: {
        checks: {
          lint: "bun run lint",
          types: "bun run types",
          unit: "bun test",
        },
        setup: "bun install --frozen-lockfile --ignore-scripts",
        test: "bun test {path}",
      },
      weakening: { markers: ["xit("] },
    });

    const policy = decodePolicy(toPolicyInput(definition));

    expect(policy.run).toStrictEqual({
      checks: {
        lint: "bun run lint",
        types: "bun run types",
        unit: "bun test",
      },
      setup: "bun install --frozen-lockfile --ignore-scripts",
      test: "bun test {path}",
    });
    expect(policy.claims).toStrictEqual({
      lapseAfterMs: 172_800_000,
      warnAfterMs: 10_800_000,
    });
    expect(policy.kinds).toStrictEqual([
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
      {
        checkKind: "lintToZero",
        claimers: "vouched",
        finish: "never",
        name: "lintToZero",
        oneWay: false,
        race: 1,
        requires: ["want", "check", "territory"],
        strength: "assertion",
      },
      {
        checkKind: "redThenGreen",
        claimers: "vouched",
        finish: "required",
        name: "changeJudge",
        oneWay: true,
        race: 1,
        requires: ["want", "check", "territory"],
        strength: "assertion",
      },
    ]);
    expect(policy.ratchets).toStrictEqual([
      {
        measure: RatchetMeasure.cases.Metric.make({
          command: RatchetMeasure.cases.Metric.fields.command.make(
            "bun run size --json"
          ),
          path: RatchetMeasure.cases.Metric.fields.path.make("/total"),
        }),
        name: "bundle-kb",
      },
      {
        measure: RatchetMeasure.cases.Count.make({
          command: RatchetMeasure.cases.Count.fields.command.make(
            "bun run lint --format json"
          ),
          rule: "typescript/no-explicit-any",
        }),
        name: "no-explicit-any",
        territory: "datekit",
      },
    ]);
    expect(policy.weakening).toStrictEqual({ markers: ["xit("] });
  });

  it("encodes the settings a project writes, not the defaults", () => {
    const written = decodePolicy(
      toPolicyInput(
        project({
          agents: "none",
          budget: { decisionsPerDay: 3, expire: "3 weeks" },
          caps: { claimsPerPerson: 1, proposalsPerPerson: 4 },
          record: { countsAfter: "1 week", window: "180 days" },
          vouch: { file: "MAINTAINERS/vouched.td", mode: "all" },
        })
      )
    );

    expect(written).toMatchObject({
      agents: "none",
      budget: { decisionsPerDay: 3, expireDays: 21 },
      caps: { claimsPerPerson: 1, proposalsPerPerson: 4 },
      record: { countsAfterDays: 7, windowDays: 180 },
      vouch: { file: "MAINTAINERS/vouched.td", mode: "all" },
    });
    expect(
      decodePolicy(toPolicyInput(project({ vouch: "bansOnly" }))).vouch
    ).toStrictEqual({
      file: `${Brand.configDir}/vouched.td`,
      mode: "bansOnly",
    });
  });

  it("encodes a project with no config folder to the defaults: one fix kind, the run block from CI", () => {
    const policy = decodePolicy(toPolicyInput(defaults));

    expect(policy).toStrictEqual({
      agents: "trailer",
      asks: [],
      budget: { decisionsPerDay: 5, expireDays: 14 },
      caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
      claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
      deciders: [{ handles: "owners", paths: "**" }],
      functions: { admit: false, opensAlone: false },
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
      run: FromCI.make({}),
      source: "defaults",
      vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
      weakening: { markers: [] },
    });
    expect(Schema.is(FromCI)(run.fromCI)).toBeTruthy();
  });
});

describe("an ask file", () => {
  it("states a fix ask whose check is red then green on its path", () => {
    const definition = kinds.fix.ask({
      current: "parseISO returns an invalid date for 2026-W41-3",
      outOfScope: ["ordinal week dates"],
      path: "test/asks/parse-iso-week.test.ts",
      territory: territory.paths("src/parse.ts"),
      want: "parseISO accepts ISO week dates like 2026-W41-3",
    });

    const ask = decodeAsk(
      toAskInput(definition, {
        askedBy: "ines-v",
        file: askFile("parse-iso-week"),
      })
    );

    expect(ask).toStrictEqual({
      askedBy: "ines-v",
      blockedBy: [],
      brief: {
        current: "parseISO returns an invalid date for 2026-W41-3",
        outOfScope: ["ordinal week dates"],
        want: "parseISO accepts ISO week dates like 2026-W41-3",
      },
      check: redThenGreen("test/asks/parse-iso-week.test.ts"),
      file: askFile("parse-iso-week"),
      id: "parse-iso-week",
      kind: "fix",
      territory: { module: ".", paths: ["src/parse.ts"] },
    });
  });

  it("requires a want, by type", () => {
    expectTypeOf(kinds.fix.ask)
      .parameter(0)
      .toHaveProperty("want")
      .toEqualTypeOf<string>();
    expectTypeOf(kinds.fix.ask)
      .parameter(0)
      .toHaveProperty("path")
      .toEqualTypeOf<string>();
  });

  it("fails at the call with a Schema issue when the kind's args are malformed", () => {
    expect(() =>
      kinds.fix.ask({
        path: "",
        territory: territory.paths("src/parse.ts"),
        want: "parseISO accepts ISO week dates",
      })
    ).toThrow(Schema.SchemaError);
  });

  it("takes its territory from its kind when the ask leaves it out", () => {
    const fixIn = kind({
      args: { path: Schema.NonEmptyString },
      check: ({ path }) => check.redThenGreen(path),
      checkKind: "redThenGreen",
      name: "fixIn",
      territory: ({ path }) =>
        territory.paths(path.replace(/^test\//u, "src/")),
    });

    const derived = fixIn.ask({
      path: "test/parse.test.ts",
      want: "parseISO accepts ISO week dates",
    });

    const stated = fixIn.ask({
      path: "test/parse.test.ts",
      territory: territory.paths("src/week.ts"),
      want: "parseISO accepts ISO week dates",
    });

    const origin = { askedBy: "ines-v", file: askFile("week") };

    expect(decodeAsk(toAskInput(derived, origin)).territory).toStrictEqual({
      module: ".",
      paths: ["src/parse.test.ts"],
    });
    expect(decodeAsk(toAskInput(stated, origin)).territory).toStrictEqual({
      module: ".",
      paths: ["src/week.ts"],
    });
  });

  it("states a migrate step and a ratchet ask with their own check kinds", () => {
    const step = kinds.migrate.ask({
      count: "node scripts/count-callers.mjs legacyFetch --json",
      from: "legacyFetch",
      parent: "drop-legacy-fetch",
      territory: territory.package("@burrow/billing"),
      to: "http.get",
      want: "billing calls http.get instead of legacyFetch",
    });

    const lower = kinds.ratchetDown.ask({
      blockedBy: ["drop-legacy-fetch-billing"],
      ratchet: "no-explicit-any",
      territory: territory.paths("packages/core/**"),
      want: "core has fewer explicit anys",
    });

    const origin = { askedBy: "ines-v", file: askFile("billing") };

    expect(decodeAsk(toAskInput(step, origin))).toMatchObject({
      check: Migrate.make({
        count: Migrate.fields.count.make(
          "node scripts/count-callers.mjs legacyFetch --json"
        ),
        from: symbol("legacyFetch"),
        to: symbol("http.get"),
      }),
      kind: "migrate",
      parent: "drop-legacy-fetch",
      territory: { module: "@burrow/billing", paths: ["{dir}/**"] },
    });
    expect(decodeAsk(toAskInput(lower, origin))).toMatchObject({
      blockedBy: ["drop-legacy-fetch-billing"],
      check: Ratchet.make({
        ratchet: Ratchet.fields.ratchet.make("no-explicit-any"),
      }),
      kind: "ratchetDown",
    });
  });

  it("fails at the call with a Schema issue when a kind's own data is malformed", () => {
    expect(() =>
      kind({
        args: { path: Schema.NonEmptyString },
        check: ({ path }) => check.redThenGreen(path),
        checkKind: "redThenGreen",
        name: "Fix Bug",
      })
    ).toThrow(Schema.SchemaError);
    expect(() =>
      kind({
        args: { path: Schema.NonEmptyString },
        check: ({ path }) => check.redThenGreen(path),
        checkKind: "redThenGreen",
        name: "fixHalf",
        race: 1.5,
      })
    ).toThrow(Schema.SchemaError);
  });

  it("states a lint-to-zero ask with the rule and the project's own command", () => {
    const ask = kinds.lintToZero.ask({
      command: "bun run lint --format json",
      reserve: "newcomers",
      rule: "no-floating-effect",
      territory: territory.paths("src/**"),
      want: "no-floating-effect reports nothing in src",
    });

    expect(
      decodeAsk(toAskInput(ask, { askedBy: "okonkwo", file: askFile("lint") }))
    ).toMatchObject({
      check: LintToZero.make({
        command: LintToZero.fields.command.make("bun run lint --format json"),
        rule: "no-floating-effect",
      }),
      reserve: "newcomers",
    });
  });
});

describe("function-valued rules", () => {
  const trusted = kind({
    args: { path: Schema.NonEmptyString },
    check: ({ path }) => check.redThenGreen(path),
    checkKind: "redThenGreen",
    name: "trusted",
    opensAlone: (proposal) => proposal.record >= 3,
  });

  const definition = project({ kinds: [kinds.fix, trusted] });

  it("are flagged in the data, and left out of it", () => {
    const encoded = toPolicyInput(definition);
    const json = JSON.stringify(encoded);

    expect(encoded.functions).toStrictEqual({
      admit: false,
      opensAlone: true,
    });
    expect(JSON.parse(json)).toStrictEqual(encoded);
    expect(JSON.stringify(definition)).toBe(json);
  });

  it("answer opensAlone on demand, by the proposal's kind", () => {
    const { opensAlone } = functionsOf(definition);

    const facts = {
      kind: "trusted",
      proposer: "carol",
      record: 3,
      territory: ".",
    };

    expect(opensAlone?.(decodeProposal(facts))).toBeTruthy();
    expect(opensAlone?.(decodeProposal({ ...facts, record: 2 }))).toBeFalsy();
    expect(opensAlone?.(decodeProposal({ ...facts, kind: "fix" }))).toBeFalsy();
  });

  it("are told only facts that decode as the domain's handles, kinds and counts", () => {
    const facts = {
      kind: "trusted",
      proposer: "carol",
      record: 3,
      territory: ".",
    };

    expect(() => decodeProposal({ ...facts, proposer: "@carol" })).toThrow(
      Schema.SchemaError
    );
    expect(() => decodeProposal({ ...facts, kind: "Trusted Kind" })).toThrow(
      Schema.SchemaError
    );
    expect(() => decodeProposal({ ...facts, record: -1 })).toThrow(
      Schema.SchemaError
    );
    expect(() =>
      decodeClaimant({
        handle: "bram smith",
        kind: "fix",
        record: 0,
        territory: ".",
        vouched: true,
      })
    ).toThrow(Schema.SchemaError);
  });

  it("flag admit when the project writes one", () => {
    const admitting = project({
      admit: (claimant) => claimant.vouched || claimant.record > 0,
    });

    expect(toPolicyInput(admitting).functions).toStrictEqual({
      admit: true,
      opensAlone: false,
    });
    expect(
      functionsOf(admitting).admit?.(
        decodeClaimant({
          handle: "bram",
          kind: "fix",
          record: 0,
          territory: ".",
          vouched: true,
        })
      )
    ).toBeTruthy();
  });
});
