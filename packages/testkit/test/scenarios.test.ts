import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Command, SymbolName } from "@repo/protocol/domain/common";
import { Policy } from "@repo/protocol/domain/policy";
import { CommitSha, DecisionId, RepoPath, RequestId } from "@repo/protocol/ids";
import { DateTime, Equal, Schema } from "effect";
import { onTestFinished, vi } from "vitest";

import {
  aProject,
  ids,
  sha,
  sixChildren,
  withAsk,
  withKind,
  withVouches,
} from "../src/scenarios.ts";

const six = [1, 2, 3, 4, 5, 6];

const children = six.map((n) => `drop-legacy-fetch-p${n}`);

const isPolicy = Schema.is(Policy);

const isAsk = Schema.is(Ask);

const lintToZero = CheckSpec.cases.LintToZero.make({
  command: Command.make("bun run lint --format json"),
  rule: "no-floating-effect",
});

const lintKind = {
  checkKind: "lintToZero",
  claimers: "anyone",
  finish: "never",
  name: "lintToZero",
  oneWay: false,
  race: 1,
  requires: ["want"],
  strength: "assertion",
} as const;

const parserFix = () =>
  aProject().pipe(
    withAsk({ id: "fix-parser", territory: "packages/parser" }),
    withVouches(["bob"])
  );

describe("a project scenario", () => {
  it("holds a policy that decodes as a Policy, at its landed commit", () => {
    const { landed, policy } = aProject();

    expect(isPolicy(policy)).toBeTruthy();
    expect(
      Schema.decodeSync(Policy)(Schema.encodeSync(Policy)(policy))
    ).toStrictEqual(policy);
    expect(policy.at).toBe(landed);
    expect(policy.vouch.file).toBe(`${Brand.configDir}/vouched.td`);
    expect(policy.kinds.map(({ name }) => name)).toStrictEqual([
      "fix",
      "migrate",
    ]);
  });

  it("is decided, by default, by its initializer alice, for every path", () => {
    const { initializer, policy, project } = aProject();

    expect({ initializer, project }).toStrictEqual({
      initializer: "alice",
      project: "alice/datekit",
    });
    expect(policy.deciders).toStrictEqual([
      { handles: ["alice"], paths: "**" },
    ]);
  });

  it("names its people by the names it was given, maintainers first", () => {
    const scenario = aProject({
      deciders: ["dana", "eve"],
      name: "burrow",
      people: ["bob", "carol"],
    });

    expect(scenario.project).toBe("dana/burrow");
    expect(scenario.initializer).toBe("dana");
    expect([...scenario.people]).toStrictEqual([
      ["dana", "dana"],
      ["eve", "eve"],
      ["bob", "bob"],
      ["carol", "carol"],
    ]);
    expect(scenario.policy.deciders).toStrictEqual([
      { handles: ["dana", "eve"], paths: "**" },
    ]);
  });

  it("opens an ask in its territory, asked by the initializer in the landed commit", () => {
    const now = DateTime.makeUnsafe("2026-10-09T08:30:00Z");

    const scenario = aProject({ now }).pipe(
      withAsk({ id: "fix-parser", territory: "packages/parser" })
    );

    const [ask] = scenario.policy.asks;

    expect(isAsk(ask)).toBeTruthy();
    expect(ask).toStrictEqual({
      askedBy: "alice",
      blockedBy: [],
      brief: { want: "fix-parser: its check passes in packages/parser" },
      check: CheckSpec.cases.RedThenGreen.make({
        path: RepoPath.make("packages/parser/test/fix-parser.test.ts"),
      }),
      file: `${Brand.configDir}/asks/fix-parser.ask.ts`,
      id: "fix-parser",
      kind: "fix",
      openedAt: now,
      openedIn: scenario.landed,
      project: "alice/datekit",
      state: "open",
      territory: { module: "parser", paths: ["packages/parser/**"] },
    });
    expect(scenario.policy.modules).toStrictEqual([
      { module: "parser", paths: ["packages/parser/**"] },
    ]);
    expect(isPolicy(scenario.policy)).toBeTruthy();
  });

  it("takes an ask's kind, check, blockers and reserve, and keeps one module per territory", () => {
    const scenario = aProject().pipe(
      withAsk({ id: "fix-parser", territory: "packages/parser" }),
      withAsk({
        blockedBy: ["fix-parser"],
        check: lintToZero,
        id: "lint-parser",
        kind: "lintToZero",
        reserve: "newcomers",
        territory: "packages/parser",
      })
    );

    const [, ask] = scenario.policy.asks;

    expect(isAsk(ask)).toBeTruthy();
    expect(ask).toMatchObject({
      blockedBy: ["fix-parser"],
      check: lintToZero,
      kind: "lintToZero",
      reserve: "newcomers",
    });
    expect(scenario.policy.modules).toHaveLength(1);
  });

  it("opens an ask over the whole repo without making the repo a module", () => {
    const scenario = aProject().pipe(
      withAsk({ id: "tidy-readme", territory: "." })
    );

    expect(scenario.policy.asks[0]?.territory).toStrictEqual({
      module: ".",
      paths: ["**"],
    });
    expect(scenario.policy.modules).toStrictEqual([]);
  });

  it("refuses an ask the domain refuses, such as one named after a reserved word", () => {
    expect(() =>
      aProject().pipe(withAsk({ id: "me", territory: "packages/parser" }))
    ).toThrow("reserved");
  });

  it("adds a kind, replacing one of the same name", () => {
    const scenario = aProject().pipe(
      withKind(lintKind),
      withKind({ ...lintKind, race: 2 })
    );

    expect(scenario.policy.kinds.map(({ name }) => name)).toStrictEqual([
      "fix",
      "migrate",
      "lintToZero",
    ]);
    expect(scenario.policy.kinds[2]).toStrictEqual({ ...lintKind, race: 2 });
  });

  it("records vouches and denouncements as the vouch file's lines", () => {
    const scenario = aProject().pipe(
      withVouches(["bob", "carol"], ["mallory"])
    );

    expect(scenario.policy.vouches).toStrictEqual([
      { denounced: false, handle: "bob" },
      { denounced: false, handle: "carol" },
      { denounced: true, handle: "mallory" },
    ]);
    expect(isPolicy(scenario.policy)).toBeTruthy();
  });

  it("builds the same value every time", () => {
    expect(Equal.equals(parserFix(), parserFix())).toBeTruthy();
    expect(Equal.equals(sixChildren(), sixChildren())).toBeTruthy();
    expect(Equal.equals(parserFix(), aProject({ name: "burrow" }))).toBeFalsy();
  });
});

describe("six children of a migrate ask", () => {
  it("is a parent, six children and a delete child, each a valid ask", () => {
    const { policy } = sixChildren();

    expect(policy.asks.map(({ id }) => id)).toStrictEqual([
      "drop-legacy-fetch",
      ...children,
      "drop-legacy-fetch-delete",
    ]);
    expect(policy.asks.every((ask) => isAsk(ask))).toBeTruthy();
    expect(isPolicy(policy)).toBeTruthy();
  });

  it("has a parent migrating the symbol across the six packages", () => {
    const [parent] = sixChildren().policy.asks;

    expect(parent).toMatchObject({
      check: CheckSpec.cases.Migrate.make({
        count: Command.make(
          "node scripts/count-callers.mjs legacyFetch --json"
        ),
        from: SymbolName.make("legacyFetch"),
        to: SymbolName.make("http.get"),
      }),
      kind: "migrate",
      territory: { paths: six.map((n) => `packages/p${n}/**`) },
    });
    expect(parent?.parent).toBeUndefined();
  });

  it("splits into six children on disjoint packages, the project's modules", () => {
    const { policy } = sixChildren();
    const steps = policy.asks.slice(1, 7);

    expect(
      steps.map(({ blockedBy, id, parent, territory }) => ({
        blockedBy,
        id,
        parent,
        territory,
      }))
    ).toStrictEqual(
      six.map((n) => ({
        blockedBy: [],
        id: `drop-legacy-fetch-p${n}`,
        parent: "drop-legacy-fetch",
        territory: { module: `p${n}`, paths: [`packages/p${n}/**`] },
      }))
    );
    expect(
      steps.every(({ check }) => CheckSpec.guards.Migrate(check))
    ).toBeTruthy();
    expect(policy.modules.map(({ module }) => module)).toStrictEqual(
      six.map((n) => `p${n}`)
    );
  });

  it("ends with a delete child blocked by all six", () => {
    const last = sixChildren().policy.asks.at(-1);

    expect(last).toMatchObject({
      blockedBy: children,
      check: CheckSpec.cases.SymbolAbsent.make({
        count: Command.make(
          "node scripts/count-callers.mjs legacyFetch --json"
        ),
        symbol: SymbolName.make("legacyFetch"),
      }),
      parent: "drop-legacy-fetch",
    });
  });

  it("names the family after the symbol it moves", () => {
    const { policy } = sixChildren({ symbol: "oldClock", to: "clock.now" });

    expect(policy.asks.map(({ id }) => id)).toStrictEqual([
      "drop-old-clock",
      ...six.map((n) => `drop-old-clock-p${n}`),
      "drop-old-clock-delete",
    ]);
    expect(policy.asks[0]?.check).toMatchObject({
      from: "oldClock",
      to: "clock.now",
    });
  });
});

describe("deterministic ids", () => {
  it("makes a commit id from a seed with FNV-1a, the same every run", () => {
    // Worked out by a separate FNV-1a implementation over `0:main` … `4:main`.
    expect(sha("main")).toBe("72245cbe78d5b41b2cadf2502b38c3a5d6578b1a");
    expect(Schema.is(CommitSha)(sha("main"))).toBeTruthy();
    expect(sha("main")).not.toBe(sha("answer"));
    expect(aProject().landed).toBe("82d7409c24ead4d50f7614f6673ecdd72315be58");
  });

  it("mints request and decision ids from counters", () => {
    const next = ids();

    expect([next.request(), next.request()]).toStrictEqual([
      "req-000001",
      "req-000002",
    ]);
    expect(next.decision()).toBe("dec-000001");
    expect(ids().request()).toBe("req-000001");
  });

  it("mints ids the domain accepts", () => {
    const next = ids();

    expect(Schema.is(RequestId)(next.request())).toBeTruthy();
    expect(Schema.is(DecisionId)(next.decision())).toBeTruthy();
  });

  it("builds every value without reading the clock or randomness", () => {
    const reads = {
      getRandomValues: vi.spyOn(crypto, "getRandomValues"),
      now: vi.spyOn(Date, "now"),
      random: vi.spyOn(Math, "random"),
      randomUUID: vi.spyOn(crypto, "randomUUID"),
    };

    onTestFinished(() => {
      for (const read of Object.values(reads)) {
        read.mockRestore();
      }
    });

    const next = ids();

    parserFix();
    sixChildren();
    sha("main");
    next.request();
    next.decision();

    expect(
      Object.values(reads).map((read) => read.mock.calls.length)
    ).toStrictEqual([0, 0, 0, 0]);
  });
});
