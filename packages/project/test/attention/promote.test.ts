import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckSpec, RatchetMeasure } from "@repo/protocol/domain/check";
import { Command } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  Handle,
  LandedSha,
  ProposalId,
  RatchetName,
  RepoPath,
} from "@repo/protocol/ids";
import {
  EvaluationFacts,
  RulesEvaluator,
  sdkVersion,
} from "@repo/rules/rules-evaluator";
import { RulesEvaluatorBun } from "@repo/rules/rules-evaluator/bun";
import { at } from "@repo/testkit/clock";
import { aProject, ids, withAsk, withKind } from "@repo/testkit/scenarios";
import { Effect, Layer, Option, Result, Schema, Struct } from "effect";

import { decide } from "../../src/attention/decisions.ts";
import {
  AttentionEffect,
  platformHandle,
} from "../../src/attention/effects.ts";
import { promotions } from "../../src/attention/promote.ts";
import type { FinishRecord, Promotion } from "../../src/attention/promote.ts";
import { FinishersFromChecks, MethodSchemas } from "../../src/project.ts";

const lintToZeroKind = {
  checkKind: "lintToZero",
  claimers: "vouched",
  finish: "never",
  name: "lintToZero",
  oneWay: false,
  race: 1,
  requires: ["want", "check", "territory"],
  strength: "assertion",
} as const;

const lint = Command.make("bun run lint --format json");

const scenario = aProject({ deciders: ["alice"], people: ["bob"] }).pipe(
  withKind(lintToZeroKind)
);

const policy: Policy = {
  ...scenario.policy,
  ratchets: [
    {
      measure: RatchetMeasure.cases.Count.make({
        command: lint,
        rule: "no-explicit-any",
      }),
      name: RatchetName.make("no-explicit-any"),
    },
  ],
};

const alice = Handle.make("alice");

const now = at("2026-10-07T12:00:00Z");

const rule = "no-date-equality";

const askFile = RepoPath.make(
  `${Brand.configDir}/asks/no-date-equality-in-src-date.ask.ts`
);

const finish = (
  ask: string,
  day: string,
  more: Partial<FinishRecord> = {}
): FinishRecord => ({
  area: "src/date",
  ask: AskId.make(ask),
  at: at(`${day}T09:00:00Z`),
  decider: alice,
  note: Option.none(),
  paths: [RepoPath.make(`src/date/${ask}.ts`)],
  rule: Option.none(),
  ...more,
});

const compareDays = finish("compare-days", "2026-10-01", {
  note: Option.some(rule),
});

const diffMonths = finish("diff-months", "2026-10-05", {
  note: Option.some(`Date compared with === again: \`${rule}\``),
});

const pair = [compareDays, diffMonths];

const promote = (
  finishes: readonly FinishRecord[],
  options: {
    readonly existing?: readonly Decision[];
    readonly policy?: Policy;
    readonly now?: typeof now;
  } = {}
) => {
  const minted = ids();

  return promotions({
    existing: options.existing ?? [],
    finishes,
    ids: { decision: minted.decision(), proposal: minted.proposal() },
    now: options.now ?? now,
    policy: options.policy ?? policy,
    project: scenario.project,
  });
};

const shown = ({ decision, proposal }: Promotion) =>
  decision.evidence.filter(
    ({ label }) => !proposal.files.some((path) => path === label)
  );

const heldFiles = ({ decision, proposal }: Promotion) =>
  proposal.files.flatMap((path) =>
    decision.evidence.flatMap(({ label, value }) =>
      label === path ? [{ content: value, path }] : []
    )
  );

describe("promoting a repeated finish", () => {
  it("puts two finishes in one area for the same rule to their maintainer as one decision, declined by default", () => {
    const made = promote(pair);

    expect(
      made.map((promotion) => ({
        deciders: promotion.decision.deciders,
        default: promotion.decision.default,
        evidence: shown(promotion),
        proposal: promotion.proposal,
        subject: promotion.decision.subject,
      }))
    ).toStrictEqual([
      {
        deciders: [alice],
        default: "decline",
        evidence: [
          {
            label: "want",
            value:
              "The lint rule `no-date-equality` reports nothing in src/date/**",
          },
          { label: "area", value: "src/date" },
          { label: "rule", value: rule },
          {
            label: "why",
            value:
              "alice finished 2 answers for the same thing (no-date-equality)",
          },
          {
            label: "finished",
            value: "compare-days by alice on 2026-10-01: no-date-equality",
          },
          {
            label: "finished",
            value:
              "diff-months by alice on 2026-10-05: Date compared with === again: `no-date-equality`",
          },
          { label: "promoted from", value: "compare-days diff-months" },
        ],
        proposal: {
          expiresAt: at("2026-10-21T12:00:00Z"),
          files: [askFile],
          id: ProposalId.make("prop-000001"),
          openedAt: now,
          project: scenario.project,
          proposer: platformHandle,
          state: "open",
          territory: "src/date/**",
          want: "The lint rule `no-date-equality` reports nothing in src/date/**",
        },
        subject: DecisionSubject.cases.OpenProposal.make({
          proposal: ProposalId.make("prop-000001"),
        }),
      },
    ]);
  });
});

const lineOf = (made: readonly Promotion[], label: string) =>
  made.flatMap(({ decision }) =>
    decision.evidence.flatMap((each) =>
      each.label === label ? [each.value] : []
    )
  );

const declined = (decision: Decision): Decision => ({
  ...decision,
  decided: { at: now, by: alice, choice: "decline" },
});

const carol = Handle.make("carol");

const twice = (note: string) =>
  promote([
    finish("compare-days", "2026-10-01", { note: Option.some(note) }),
    finish("diff-months", "2026-10-05", { note: Option.some(note) }),
  ]);

describe("what a promotion is made from", () => {
  it("takes the rule a finish's lanes name, when its note names none", () => {
    const made = promote([
      finish("compare-days", "2026-10-01", { rule: Option.some(rule) }),
      finish("diff-months", "2026-10-05", {
        note: Option.some("Dates compared by reference, not by value"),
        rule: Option.some(rule),
      }),
    ]);

    expect([lineOf(made, "rule"), lineOf(made, "why")]).toStrictEqual([
      [rule],
      ["alice finished 2 answers for the same thing (no-date-equality)"],
    ]);
  });

  it("promotes nothing for one finish, two finishes for different rules, or notes in prose alone", () => {
    expect([
      promote([
        finish("compare-days", "2026-10-01", { rule: Option.some(rule) }),
      ]),
      promote([
        finish("compare-days", "2026-10-01", { rule: Option.some(rule) }),
        finish("diff-months", "2026-10-05", {
          rule: Option.some("no-implicit-utc"),
        }),
      ]),
      promote([
        finish("compare-days", "2026-10-01", {
          note: Option.some("Date compared with ==="),
        }),
        finish("diff-months", "2026-10-05", {
          note: Option.some("Date compared with ==="),
        }),
      ]),
    ]).toStrictEqual([[], [], []]);
  });

  it("reads no rule in a one-word note or a code span that is not a rule's id", () => {
    expect([
      twice("typo"),
      twice("Renamed `startOfDay`"),
      twice("`No-Date-Equality`"),
    ]).toStrictEqual([[], [], []]);
  });

  it("puts a rule the lanes name and the same rule a note names in one group", () => {
    const made = promote([
      finish("compare-days", "2026-10-01", { rule: Option.some(rule) }),
      diffMonths,
    ]);

    expect(lineOf(made, "promoted from")).toStrictEqual([
      "compare-days diff-months",
    ]);
  });

  it("promotes nothing for the same rule in two areas", () => {
    expect(
      promote([
        compareDays,
        finish("parse-zone", "2026-10-05", {
          area: "src/tz",
          note: Option.some(rule),
          paths: [RepoPath.make("src/tz/parse-zone.ts")],
        }),
      ])
    ).toStrictEqual([]);
  });

  it("counts only finishes within the record window", () => {
    const short: Policy = {
      ...policy,
      record: { countsAfterDays: 0, windowDays: 3 },
    };

    expect([
      promote(pair, { policy: short }),
      promote(pair, { now: at("2026-10-03T12:00:00Z") }),
    ]).toStrictEqual([[], []]);
  });

  it("holds the repo-wide area to the folders the finishes touched", () => {
    const made = promote([
      finish("compare-days", "2026-10-01", {
        area: ".",
        paths: [RepoPath.make("src/date/compare.ts")],
        rule: Option.some(rule),
      }),
      finish("parse-zone", "2026-10-05", {
        area: ".",
        paths: [RepoPath.make("src/tz/parse.ts")],
        rule: Option.some(rule),
      }),
    ]);

    expect(
      made.map(({ decision, proposal }) => ({
        area: lineOf([{ decision, proposal }], "area"),
        proposal: Struct.pick(proposal, ["files", "territory", "want"]),
      }))
    ).toStrictEqual([
      {
        area: ["."],
        proposal: {
          files: [
            RepoPath.make(`${Brand.configDir}/asks/no-date-equality.ask.ts`),
          ],
          territory: "src/date/**, src/tz/**",
          want: "The lint rule `no-date-equality` reports nothing in src/date/**, src/tz/**",
        },
      },
    ]);
  });

  it("holds a module area to its package", () => {
    const parser = aProject({ deciders: ["alice"] }).pipe(
      withKind(lintToZeroKind),
      withAsk({ id: "parse-iso", territory: "packages/parser" })
    );

    const made = promote(
      [
        finish("parse-weeks", "2026-10-01", {
          area: "parser",
          paths: [RepoPath.make("packages/parser/src/weeks.ts")],
          rule: Option.some(rule),
        }),
        finish("parse-days", "2026-10-05", {
          area: "parser",
          paths: [RepoPath.make("packages/parser/src/days.ts")],
          rule: Option.some(rule),
        }),
      ],
      { policy: { ...parser.policy, ratchets: policy.ratchets } }
    );

    expect(
      made.map(({ proposal }) =>
        Struct.pick(proposal, ["files", "territory", "want"])
      )
    ).toStrictEqual([
      {
        files: [
          RepoPath.make(
            `${Brand.configDir}/asks/no-date-equality-in-parser.ask.ts`
          ),
        ],
        territory: "parser",
        want: "The lint rule `no-date-equality` reports nothing in parser",
      },
    ]);
  });
});

describe("whom a promotion is put to", () => {
  it("puts it to the finishers who still decide for what they touched", () => {
    const made = promote([
      finish("compare-days", "2026-10-01", {
        decider: carol,
        rule: Option.some(rule),
      }),
      finish("diff-months", "2026-10-05", { rule: Option.some(rule) }),
    ]);

    expect([
      made.map(({ decision }) => decision.deciders),
      lineOf(made, "why"),
    ]).toStrictEqual([
      [[alice]],
      [
        "carol and alice finished 2 answers for the same thing (no-date-equality)",
      ],
    ]);
  });

  it("names a finisher once, however their handle is cased", () => {
    const made = promote([
      compareDays,
      { ...diffMonths, decider: Handle.make("Alice") },
    ]);

    expect([
      made.map(({ decision }) => decision.deciders),
      lineOf(made, "why"),
    ]).toStrictEqual([
      [[alice]],
      ["alice finished 2 answers for the same thing (no-date-equality)"],
    ]);
  });

  it("promotes nothing when no finisher decides any more", () => {
    expect(
      promote(pair.map((each) => ({ ...each, decider: carol })))
    ).toStrictEqual([]);
  });
});

describe("when a project cannot hold the ask", () => {
  it("promotes nothing without a lintToZero kind, a JSON lint command, or while an ask holds the rule already", () => {
    const asked = aProject({ deciders: ["alice"] }).pipe(
      withKind(lintToZeroKind),
      withAsk({
        check: CheckSpec.cases.LintToZero.make({ command: lint, rule }),
        id: "no-date-equality",
        kind: "lintToZero",
        territory: ".",
      })
    );

    expect([
      promote(pair, {
        policy: {
          ...policy,
          kinds: scenario.policy.kinds.filter(
            ({ checkKind }) => checkKind !== "lintToZero"
          ),
        },
      }),
      promote(pair, { policy: { ...policy, ratchets: [] } }),
      promote(pair, { policy: asked.policy }),
    ]).toStrictEqual([[], [], []]);
  });

  it("takes the lint command from a lintToZero ask when no ratchet counts", () => {
    const asked = aProject({ deciders: ["alice"] }).pipe(
      withKind(lintToZeroKind),
      withAsk({
        check: CheckSpec.cases.LintToZero.make({
          command: Command.make("oxlint --format json"),
          rule: "no-explicit-any",
        }),
        id: "no-any",
        kind: "lintToZero",
        territory: ".",
      })
    );

    expect(
      promote(pair, { policy: asked.policy }).flatMap((made) =>
        heldFiles(made).flatMap(({ content }) =>
          content.split("\n").filter((line) => line.includes("command:"))
        )
      )
    ).toStrictEqual(['  command: "oxlint --format json",']);
  });
});

describe("promoting again", () => {
  it("makes one decision for the same pair, open, declined or expired", () => {
    const [first] = promote(pair);
    const opened = first?.decision;

    expect(
      opened === undefined
        ? ["no promotion"]
        : [
            promote(pair, { existing: [opened] }),
            promote(pair, { existing: [declined(opened)] }),
            promote(pair, {
              existing: [opened],
              now: at("2026-10-22T12:00:00Z"),
            }),
          ]
    ).toStrictEqual([[], [], []]);
  });

  it("waits while one is open, then asks again from two new finishes after a decline", () => {
    const [first] = promote(pair);
    const opened = first?.decision;

    const later = [
      ...pair,
      finish("add-weeks", "2026-10-06", { rule: Option.some(rule) }),
      finish("start-of-day", "2026-10-07", { rule: Option.some(rule) }),
    ];

    expect(
      opened === undefined
        ? ["no promotion"]
        : [
            lineOf(promote(later, { existing: [opened] }), "promoted from"),
            lineOf(
              promote(later, { existing: [declined(opened)] }),
              "promoted from"
            ),
          ]
    ).toStrictEqual([[], ["add-weeks start-of-day"]]);
  });
});

describe("accepting a promotion", () => {
  it("opens its ask through openAsk's input: the ask's id and its one file", () => {
    const [made] = promote(pair);

    const accepted =
      made === undefined
        ? Result.fail("no promotion")
        : Result.map(
            decide([made.decision], {
              by: alice,
              choice: "accept",
              id: made.decision.id,
              note: Option.none(),
              now,
            }),
            ({ effects }) => ({
              effects: effects.filter(AttentionEffect.$is("OpenAsk")),
              input: Schema.decodeUnknownOption(MethodSchemas.openAsk.args[1])({
                ask: "no-date-equality-in-src-date",
                files: heldFiles(made),
              }).pipe(
                Option.map(({ ask, files }) => ({
                  ask,
                  paths: files.map(({ path }) => path),
                }))
              ),
            })
          );

    expect(accepted).toStrictEqual(
      Result.succeed({
        effects: [
          AttentionEffect.OpenAsk({ proposal: ProposalId.make("prop-000001") }),
        ],
        input: Option.some({
          ask: AskId.make("no-date-equality-in-src-date"),
          paths: [askFile],
        }),
      })
    );
  });
});

const facts = Schema.decodeSync(EvaluationFacts)({
  ci: [],
  initializer: "alice",
  now: "2026-10-07T12:00:00.000Z",
  project: scenario.project,
  seed: 7,
  workspaces: [{ dir: "packages/parser", exports: [], name: "parser" }],
});

const projectFile = [
  `import { kinds, project } from "${Brand.cliPackage}/rules";`,
  "",
  "export default project({",
  "  kinds: [kinds.lintToZero],",
  '  run: { checks: {}, test: "bun test {path}" },',
  "});",
  "",
].join("\n");

const evaluated = (made: readonly Promotion[]) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;

    const read = yield* evaluator.evaluate({
      at: LandedSha.make("a".repeat(40)),
      facts,
      modules: {
        entry: `${Brand.configDir}/project.ts`,
        modules: {
          [`${Brand.configDir}/project.ts`]: projectFile,
          ...Object.fromEntries(
            made.flatMap(heldFiles).map(({ content, path }) => [path, content])
          ),
        },
        sdkVersion,
      },
    });

    return read.asks.map((ask) =>
      Struct.pick(ask, ["brief", "check", "file", "id", "kind", "territory"])
    );
  }).pipe(
    Effect.provide(
      RulesEvaluatorBun.pipe(
        Layer.provide(Layer.mergeAll(FinishersFromChecks, NodeServices.layer))
      )
    )
  );

const throughTheSdk = { timeout: 60_000 };

describe("a promotion's ask file", () => {
  it.live(
    "evaluates, through the sdk, to a lintToZero ask for the rule in the folders the finishes touched",
    () =>
      Effect.gen(function* () {
        const asks = yield* evaluated(promote(pair));

        expect(asks).toStrictEqual([
          {
            brief: {
              want: "The lint rule `no-date-equality` reports nothing in src/date/**",
            },
            check: CheckSpec.cases.LintToZero.make({ command: lint, rule }),
            file: askFile,
            id: AskId.make("no-date-equality-in-src-date"),
            kind: "lintToZero",
            territory: { module: ".", paths: ["src/date/**"] },
          },
        ]);
      }),
    throughTheSdk
  );

  it.live(
    "keeps the project's own kind name, and a module area's package",
    () =>
      Effect.gen(function* () {
        const parser = aProject({ deciders: ["alice"] }).pipe(
          withKind({ ...lintToZeroKind, name: "lintAway" }),
          withAsk({ id: "parse-iso", territory: "packages/parser" })
        );

        const asks = yield* evaluated(
          promote(
            [
              finish("parse-weeks", "2026-10-01", {
                area: "parser",
                paths: [RepoPath.make("packages/parser/src/weeks.ts")],
                rule: Option.some(rule),
              }),
              finish("parse-days", "2026-10-05", {
                area: "parser",
                paths: [RepoPath.make("packages/parser/src/days.ts")],
                rule: Option.some(rule),
              }),
            ],
            { policy: { ...parser.policy, ratchets: policy.ratchets } }
          )
        );

        expect(
          asks.map((ask) => Struct.pick(ask, ["check", "kind", "territory"]))
        ).toStrictEqual([
          {
            check: CheckSpec.cases.LintToZero.make({ command: lint, rule }),
            kind: "lintAway",
            territory: { module: "parser", paths: ["packages/parser/**"] },
          },
        ]);
      }),
    throughTheSdk
  );
});
