import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Result } from "effect";

import { Outcome } from "../src/domain/outcome.ts";
import {
  AskId,
  CommitSha,
  DecisionId,
  EnvKey,
  Handle,
  LandedSha,
  ProjectName,
  ProposalId,
  RepoPath,
  RequestId,
} from "../src/ids.ts";
import {
  CapReached,
  ChecksFailed,
  DirectPush,
  DraftInProgress,
  NotDecider,
  OutOfScope,
  PrivatePathInPublicTree,
  ProposalClosed,
  ReachedInternals,
  StaleBase,
  TouchedJudge,
  UnknownPath,
  UnknownProposal,
  UnknownRevision,
  ValueTooShort,
  Weakened,
} from "../src/refusal.ts";
import { explain, headline, receiptLine } from "../src/render.ts";
import { ask, base, examples, main, path } from "./examples.ts";

const outOfScope = new OutOfScope({ paths: [path] });

const touchedJudge = new TouchedJudge({ paths: [path] });

describe(headline, () => {
  it("names the refusal for git's ng line", () => {
    expect(headline([new StaleBase({ base, conflicts: [], main })])).toBe(
      "StaleBase"
    );
  });

  it("names the first refusal and counts the rest", () => {
    expect(headline([outOfScope, touchedJudge, outOfScope])).toBe(
      "OutOfScope and 2 more"
    );
  });
});

describe(explain, () => {
  it("gives the reason, then next, then whether retrying can help", () => {
    expect(
      explain([new StaleBase({ base, conflicts: [path], main })])
    ).toStrictEqual([
      "StaleBase: main moved to 2222222, past your base 1111111; conflicts in src/a.ts",
      "  next: git pull --rebase",
      "  retryable: yes",
    ]);
  });

  it("names the landing that last changed each conflicting path it knows of", () => {
    const landing = LandedSha.make("3333333333333333333333333333333333333333");
    const other = RepoPath.make("src/b.ts");

    expect(
      explain([
        new StaleBase({
          base,
          conflicts: [path, other, RepoPath.make("src/c.ts")],
          main,
          movedBy: [
            { ask, author: Handle.make("alice"), landing, path },
            { author: Handle.make("dora"), landing, path: other },
          ],
        }),
      ])[0]
    ).toBe(
      "StaleBase: main moved to 2222222, past your base 1111111; conflicts in src/a.ts (last changed by alice in 3333333, for fix-parser), src/b.ts (last changed by dora in 3333333), src/c.ts"
    );
  });

  it("points at the line when the refusal has one", () => {
    expect(
      explain([
        new Weakened({
          at: { line: 3, path },
          weakening: { marker: "it.skip" },
        }),
      ])
    ).toStrictEqual([
      'Weakened: adds it.skip without a reason; remove it, or give a reason after " -- " for a decider to weigh',
      "  at: src/a.ts:3",
      `  next: ${Brand.cli} check`,
      "  retryable: no",
    ]);
  });

  it.each(examples)("explains $_tag, opening with its tag", (refusal) => {
    expect(explain([refusal])[0]).toMatch(
      new RegExp(`^${refusal._tag}: \\S`, "u")
    );
  });

  it.each(examples)(
    "explains $_tag with every field it names filled in",
    (refusal) => {
      expect(explain([refusal]).join("\n")).not.toMatch(
        /undefined|null|\[object Object\]/u
      );
    }
  );

  // Each shape refusal says how to repair it, after the reason's first clause.
  it.each([
    {
      ends: "; put those files back, or flag the ask if the want needs them",
      refusal: outOfScope,
      starts: "OutOfScope: changes paths outside the ask's territory: src/a.ts",
    },
    {
      ends: "; the checks are fixed for this ask, so put them back, or flag the ask if a check is wrong",
      refusal: touchedJudge,
      starts:
        "TouchedJudge: changes files that decide what the checks do: src/a.ts",
    },
    {
      ends: '; remove it, or give a reason after " -- " for a decider to weigh',
      refusal: new Weakened({
        at: { line: 3, path },
        weakening: { marker: ".skip(" },
      }),
      starts: "Weakened: adds .skip( without a reason",
    },
    {
      ends: "; a decider declined it, so take the marker out",
      refusal: new Weakened({
        at: { line: 3, path },
        weakening: { marker: "oxlint-disable", reason: "generated code" },
      }),
      starts: 'Weakened: adds oxlint-disable with the reason "generated code"',
    },
    {
      ends: "; import it through that module's public exports instead",
      refusal: new ReachedInternals({
        at: { line: 1, path },
        from: path,
        to: "../../b/src/internal.ts",
      }),
      starts:
        "ReachedInternals: src/a.ts reaches into ../../b/src/internal.ts, which its module does not export",
    },
    {
      ends: "; those paths belong to a layer, so remove them from the answer",
      refusal: new PrivatePathInPublicTree({ paths: [path] }),
      starts:
        "PrivatePathInPublicTree: would put held-back paths in a public tree: src/a.ts",
    },
  ])(
    "ends $refusal._tag's reason with how to repair it",
    ({ ends, refusal, starts }) => {
      expect(explain([refusal])[0]).toBe(`${starts}${ends}`);
    }
  );

  it("explains every refusal of one push in the gate's order, each with its line", () => {
    const a = RepoPath.make("packages/a/src/x.ts");
    const test = RepoPath.make("packages/a/test/x.test.ts");

    const refusals = [
      new OutOfScope({ paths: [RepoPath.make("packages/b/src/y.ts")] }),
      new TouchedJudge({ paths: [RepoPath.make("oxlint.config.ts")] }),
      new Weakened({
        at: { line: 3, path: test },
        weakening: { marker: ".skip(" },
      }),
      new Weakened({
        at: { line: 9, path: test },
        weakening: { marker: ".only(" },
      }),
      new ReachedInternals({
        at: { line: 1, path: a },
        from: a,
        to: "../../b/src/internal.ts",
      }),
    ] as const;

    expect(explain(refusals)).toStrictEqual([
      "OutOfScope: changes paths outside the ask's territory: packages/b/src/y.ts; put those files back, or flag the ask if the want needs them",
      `  next: ${Brand.cli} check`,
      "  retryable: no",
      "TouchedJudge: changes files that decide what the checks do: oxlint.config.ts; the checks are fixed for this ask, so put them back, or flag the ask if a check is wrong",
      `  next: ${Brand.cli} check`,
      "  retryable: no",
      'Weakened: adds .skip( without a reason; remove it, or give a reason after " -- " for a decider to weigh',
      "  at: packages/a/test/x.test.ts:3",
      `  next: ${Brand.cli} check`,
      "  retryable: no",
      'Weakened: adds .only( without a reason; remove it, or give a reason after " -- " for a decider to weigh',
      "  at: packages/a/test/x.test.ts:9",
      `  next: ${Brand.cli} check`,
      "  retryable: no",
      "ReachedInternals: packages/a/src/x.ts reaches into ../../b/src/internal.ts, which its module does not export; import it through that module's public exports instead",
      "  at: packages/a/src/x.ts:1",
      `  next: ${Brand.cli} check`,
      "  retryable: no",
    ]);
  });

  // A reasoned marker opens a decision instead of a refusal, so a refused one
  // was declined by a decider: no reason given now changes that.
  it("says a decider declined a reasoned marker, and to take it out", () => {
    const lines = explain([
      new Weakened({
        at: { line: 3, path },
        weakening: { marker: ".skip(", reason: "flaky" },
      }),
    ]);

    expect(lines).toStrictEqual([
      'Weakened: adds .skip( with the reason "flaky"; a decider declined it, so take the marker out',
      "  at: src/a.ts:3",
      `  next: ${Brand.cli} check`,
      "  retryable: no",
    ]);
    expect(lines.join("\n")).not.toContain("waits for a decider");
  });

  it("leaves a raised ratchet's reason as it was", () => {
    expect(
      explain([
        new Weakened({
          weakening: {
            after: 4,
            before: 3,
            ratchet: "no-explicit-any",
            territory: "parser",
          },
        }),
      ])[0]
    ).toBe(
      "Weakened: raises the no-explicit-any ratchet in parser from 3 to 4"
    );
  });

  it("tells a direct push to main where answers go instead", () => {
    expect(explain([new DirectPush({ ref: "refs/heads/main" })])).toStrictEqual(
      [
        "DirectPush: main moves only by a landing, so refs/heads/main takes no direct push; push your answer to your claim's fork",
        `  next: ${Brand.cli} asks`,
        "  retryable: no",
      ]
    );
  });

  it("tells a push to a ref the platform writes that a fork takes branches only", () => {
    expect(
      explain([new DirectPush({ ref: `refs/notes/${Brand.slug}` })])
    ).toStrictEqual([
      `DirectPush: refs/notes/${Brand.slug} is written by the platform, not pushed; a fork takes branches only, so push your answer with git push ${Brand.slug} HEAD:main`,
      `  next: ${Brand.cli} asks`,
      "  retryable: no",
    ]);
  });

  // A cap names the limit it reached, and a rate limit when to try again; a
  // cap with no limit is claims held, as it always was.
  it.each([
    {
      reason: "you already hold 3 claims, the most this project allows",
      refusal: new CapReached({ cap: 3 }),
    },
    {
      reason: "you already hold 1 claim, the most this project allows",
      refusal: new CapReached({ cap: 1, limit: "claims" }),
    },
    {
      reason:
        "you made 10 claims in the last minute, the most the platform allows; try again in 60s",
      refusal: new CapReached({ cap: 10, limit: "claims", retryAfter: 60 }),
    },
    {
      reason:
        "you made 5 proposals in the last minute, the most the platform allows; try again in 60s",
      refusal: new CapReached({ cap: 5, limit: "proposals", retryAfter: 60 }),
    },
    {
      reason:
        "you made 1 proposal in the last minute, the most the platform allows; try again in 60s",
      refusal: new CapReached({ cap: 1, limit: "proposals", retryAfter: 60 }),
    },
    {
      reason:
        "you already have 2 open proposals here, the most this project allows",
      refusal: new CapReached({ cap: 2, limit: "proposals" }),
    },
    {
      reason:
        "you already have 1 open proposal here, the most this project allows",
      refusal: new CapReached({ cap: 1, limit: "proposals" }),
    },
    {
      reason:
        "you started 2 drafts in the last minute, the most the platform allows; try again in 60s",
      refusal: new CapReached({ cap: 2, limit: "drafts", retryAfter: 60 }),
    },
    {
      reason:
        "you started 1 draft in the last minute, the most the platform allows; try again in 30s",
      refusal: new CapReached({ cap: 1, limit: "drafts", retryAfter: 30 }),
    },
    {
      reason:
        "this proposal was already drafted 3 times, the most one proposal takes",
      refusal: new CapReached({ cap: 3, limit: "drafts" }),
    },
    {
      reason:
        "this proposal was already drafted once, the most one proposal takes",
      refusal: new CapReached({ cap: 1, limit: "drafts" }),
    },
  ])("reads CapReached as: $reason", ({ refusal, reason }) => {
    expect(explain([refusal])).toStrictEqual([
      `CapReached: ${reason}`,
      `  next: ${Brand.cli} status`,
      "  retryable: yes",
    ]);
  });

  // A code read names what it could not find and how to look with git; a
  // draft names the proposal, and where to follow it.
  it.each([
    {
      lines: [
        "UnknownPath: 2222222 has no file or folder at src/a.ts",
        "  next: git ls-tree",
        "  retryable: no",
      ],
      refusal: new UnknownPath({ commit: main, path }),
    },
    {
      lines: [
        "UnknownRevision: v9 is neither main, a commit this project holds, nor one of its tags",
        "  next: git ls-remote",
        "  retryable: no",
      ],
      refusal: new UnknownRevision({ rev: "v9" }),
    },
    {
      lines: [
        "UnknownProposal: this project has no proposal prop-000007",
        `  next: ${Brand.cli} today`,
        "  retryable: no",
      ],
      refusal: new UnknownProposal({
        proposal: ProposalId.make("prop-000007"),
      }),
    },
    {
      lines: [
        "ProposalClosed: prop-000007 was already accepted, declined or expired",
        `  next: ${Brand.cli} today`,
        "  retryable: no",
      ],
      refusal: new ProposalClosed({ proposal: ProposalId.make("prop-000007") }),
    },
    {
      lines: [
        "DraftInProgress: the platform is already drafting prop-000007's ask",
        `  next: ${Brand.cli} proposal prop-000007`,
        "  retryable: yes",
      ],
      refusal: DraftInProgress.of(ProposalId.make("prop-000007")),
    },
  ])("explains $refusal._tag with its next command", ({ lines, refusal }) => {
    expect(explain([refusal])).toStrictEqual(lines);
  });

  it("names the commit a missing path was looked for at", () => {
    expect(
      explain([
        new UnknownPath({
          commit: CommitSha.make("abcdef0".padEnd(40, "0")),
          path,
        }),
      ])[0]
    ).toBe("UnknownPath: abcdef0 has no file or folder at src/a.ts");
  });

  // The refusal never holds the value, so no reader learns it, or its length,
  // from the reason.
  it("says a value is too short by the minimum alone", () => {
    expect(
      explain([ValueTooShort.of(EnvKey.make("PAYMENTS_KEY"), 32)])
    ).toStrictEqual([
      "ValueTooShort: the value for PAYMENTS_KEY is shorter than the 32 characters it needs",
      `  next: ${Brand.cli} env set PAYMENTS_KEY --acknowledge-short`,
      "  retryable: no",
    ]);
  });

  // A log that held a stored value is never kept, and nothing points at it.
  it("says a lane's log was withheld rather than where it is", () => {
    expect(
      explain([
        new ChecksFailed({
          lane: "unit",
          logRef: ChecksFailed.withheld,
          next: "bun test",
        }),
      ])
    ).toStrictEqual([
      "ChecksFailed: the unit checks failed; their log was withheld",
      "  next: bun test",
      "  retryable: no",
    ]);
  });

  // The lane's command reproduces the failure in a clone of the fork; the log
  // is read through `evidence`, which lets in the answerer and the project's
  // deciders alone.
  it("says the checks failed on the answer, the command that shows it, and where the log is kept", () => {
    const logRef = "datekit/push-2222222/unit#1";

    expect(
      explain([new ChecksFailed({ lane: "unit", logRef, next: "bun test" })])
    ).toStrictEqual([
      `ChecksFailed: the unit checks failed on the answer; run bun test in a clone of the fork to see the failure; the log is kept as ${logRef}, which the answerer and the project's deciders read with ${Brand.cli} evidence`,
      "  next: bun test",
      "  retryable: no",
    ]);
  });

  // The CLI's local check ran the lane on this machine: no log was kept, so
  // nothing points at `evidence`.
  it("says a lane the local check ran failed here, with no kept log to read", () => {
    const lines = explain([
      new ChecksFailed({
        lane: "unit",
        logRef: ChecksFailed.localRef("unit"),
        next: "bun test",
      }),
    ]);

    expect(lines).toStrictEqual([
      "ChecksFailed: the unit checks failed on this commit; run bun test to see the failure",
      "  next: bun test",
      "  retryable: no",
    ]);
    expect(lines.join("\n")).not.toContain("evidence");
  });

  // `today` across every project raises it too, so it names no project.
  it("tells a caller they are not a decider without naming a project", () => {
    const [line] = explain([new NotDecider({})]);

    expect(line).toBe(
      "NotDecider: you are not a decider here: only the deciders a project's config names may do this"
    );
    expect(line).not.toContain("this project's");
  });

  // Below the floor no acknowledgement helps, so the next step is another value.
  it("says a value below the floor needs another value, not an acknowledgement", () => {
    expect(
      explain([ValueTooShort.belowFloor(EnvKey.make("PAYMENTS_KEY"), 3)])
    ).toStrictEqual([
      "ValueTooShort: the value for PAYMENTS_KEY is shorter than the 3 characters it needs",
      `  next: ${Brand.cli} env set PAYMENTS_KEY`,
      "  retryable: no",
    ]);
  });
});

/** A receipt for `ask` at `main`, where `outcome` says the answer stands. */
const receiptAt = (outcome: Outcome) => ({
  ask,
  base,
  head: main,
  outcome,
  project: ProjectName.make("oscabriel/datekit"),
  requestId: RequestId.make("push-2222222"),
});

describe(receiptLine, () => {
  const follow = `follow with ${Brand.cli} status`;

  it("says where the push's answer stands, in one line", () => {
    expect(
      [
        Outcome.cases.Checking.make({ stage: "merge" }),
        Outcome.cases.AwaitingDecision.make({
          decision: DecisionId.make("dec-000001"),
        }),
        Outcome.cases.AwaitingFinish.make({}),
        Outcome.cases.WaitingOnParent.make({ ask: AskId.make("parse-iso") }),
        Outcome.cases.Landed.make({ sha: LandedSha.make("3".repeat(40)) }),
      ].map((outcome) => receiptLine(receiptAt(outcome)))
    ).toStrictEqual([
      Result.succeed(`checking fix-parser at 2222222; ${follow}`),
      Result.succeed(
        `fix-parser at 2222222 waits on decision dec-000001; ${follow}`
      ),
      Result.succeed(
        `fix-parser at 2222222 passed and waits for a decider's finish; ${follow}`
      ),
      Result.succeed(
        `fix-parser at 2222222 passed and waits for parse-iso to land; ${follow}`
      ),
      Result.succeed("fix-parser at 2222222 landed as 3333333"),
    ]);
  });

  it("gives a refused answer's refusals back, for explain", () => {
    expect(
      receiptLine(
        receiptAt(Outcome.cases.Refused.make({ refusals: [outOfScope] }))
      )
    ).toStrictEqual(Result.fail([outOfScope]));
  });
});
