import { assert, describe, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { CheckSpec } from "@repo/protocol/domain/check";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { Proposal } from "@repo/protocol/domain/proposal";
import { LandedSha, LaneName, RepoName, RepoPath } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { NotRedFirst } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Arbitrary, Array, Duration, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";

import { DraftResult } from "../src/draft-runs.ts";
import type { ProjectSnapshot } from "../src/project-store.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

// A model test (ADR 0012), as `claim.model.test.ts` is for claims: generated
// histories of drafted proposals (proposed, settled red or refused, in the
// current round or a stale one, drafted again, accepted, expired) run
// through the project service over the memory world, and after every step
// the stored proposals and decisions are checked against the drafting
// invariants.

const scenario = aProject({ people: ["carol", "dave"] }).pipe(
  withVouches(["carol", "dave"]),
  withAsk({ id: "parse-week", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(project);

const People = Schema.Literals(["alice", "carol", "dave"]);

type People = typeof People.Type;

const person = (name: People) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

const redThenGreen = LaneName.make("redThenGreen");

const mainRef = RefName.make("refs/heads/main");

const ask = Option.getOrThrow(
  Array.findFirst(scenario.policy.asks, ({ id }) => id === "parse-week")
);

const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

const files = Array.make(
  { content: `export default "parse-week";\n`, path: ask.file },
  {
    content: `import { parseWeek } from "../src/parse.ts";\n`,
    path: CheckSpec.guards.RedThenGreen(ask.check)
      ? ask.check.path
      : RepoPath.make("packages/parser/test/week.test.ts"),
  }
);

const model = "@cf/openai/gpt-oss-120b";

const red = DraftResult.cases.Red.make({
  attempts: 1,
  files,
  lane: redThenGreen,
  model,
  rationale: "parseWeek is missing",
  signature: "redThenGreen: scripted failure",
});

const failed = DraftResult.cases.Failed.make({
  attempts: 3,
  model,
  refusal: new NotRedFirst({}),
});

/** Which of the (at most two) proposals a move is about, by the order they were made in. */
const Which = Schema.Literals([0, 1]);

/** A settle's round: the proposal's current one, or one either side of it. */
const Round = Schema.Literals(["current", "before", "after"]);

type Round = typeof Round.Type;

/** One thing that happens, as a history step names it. */
const Move = Schema.TaggedUnion({
  Accept: { which: Which },
  Expire: {},
  Propose: {},
  Redraft: { which: Which, who: People },
  Settle: { red: Schema.Boolean, round: Round, which: Which },
});

type Move = typeof Move.Type;

const roll = (maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ maximum, minimum: 0 })));

/** Mostly the first proposal, so one proposal lives through many moves. */
const anyWhich = roll(3).pipe(Arbitrary.map((n) => (n === 3 ? 1 : 0)));

/** Mostly the current round; a stale one now and then. */
const rounds: readonly Round[] = [
  "current",
  "current",
  "current",
  "current",
  "before",
  "after",
];

const anyRound = roll(rounds.length - 1).pipe(
  Arbitrary.map((n) => rounds[n] ?? "current")
);

/** Mostly someone who may draft again; now and then someone who may not. */
const drafters: readonly People[] = [
  "carol",
  "alice",
  "carol",
  "alice",
  "dave",
];

const anyWho = roll(drafters.length - 1).pipe(
  Arbitrary.map((n) => drafters[n] ?? "carol")
);

const settles = Arbitrary.all({
  red: Arbitrary.schema(Schema.Boolean),
  round: anyRound,
  which: anyWhich,
}).pipe(Arbitrary.map((made) => Move.cases.Settle.make(made)));

const redrafts = Arbitrary.all({ which: anyWhich, who: anyWho }).pipe(
  Arbitrary.map((made) => Move.cases.Redraft.make(made))
);

const accepts = anyWhich.pipe(
  Arbitrary.map((chosen) => Move.cases.Accept.make({ which: chosen }))
);

const proposes = Arbitrary.Constant(Move.cases.Propose.make({}));

const expires = Arbitrary.Constant(Move.cases.Expire.make({}));

/**
 * Moves by weight. A roll leans towards 0, and shrinks towards it, so a
 * settle comes first: the move that runs into most of the rules.
 */
const weighted = [
  settles,
  redrafts,
  settles,
  proposes,
  redrafts,
  settles,
  accepts,
  proposes,
  expires,
];

const moves = roll(weighted.length - 1).pipe(
  Arbitrary.flatMap((n): Arbitrary.Arbitrary<Move> => weighted[n] ?? settles)
);

const histories = Arbitrary.array(moves, { maxLength: 16 });

const offset = (round: Round) => ({ after: 1, before: -1, current: 0 })[round];

/** The labels of a proposal's evidence that are not its files. */
const notFiles = new Set([
  "want",
  "territory",
  "red first",
  "drafted by",
  "why this test",
  "draft failed",
  "sealed answer",
]);

const decisionsFor = (snapshot: ProjectSnapshot, proposal: Proposal) =>
  snapshot.decisions.filter(
    ({ subject }) =>
      DecisionSubject.guards.OpenProposal(subject) &&
      subject.proposal === proposal.id
  );

const roundOf = (proposal: Proposal) => proposal.draft?.round ?? 1;

/** The round a settle names for `proposal`, never below the first. */
const settledRound = (proposal: Proposal, round: Round) =>
  Math.max(1, roundOf(proposal) + offset(round));

/** Whether a settle of `round` is the proposal's current, unsettled round, while it is open. */
const isCurrent = (proposal: Proposal, round: number) =>
  proposal.state === "open" &&
  proposal.draft !== undefined &&
  DraftState.guards.Drafting(proposal.draft) &&
  proposal.draft.round === round;

const fileLabels = (decision: Decision) =>
  decision.evidence.flatMap(({ label }) =>
    notFiles.has(label) ? [] : [label]
  );

/**
 * What a step broke. No decision exists while a proposal drafts its first
 * round; a settle of a stale round, or of a closed proposal, changes
 * nothing; an open `Ready` proposal's files are exactly the files its
 * decision's evidence holds, beside its red first, and a `Failed` one's
 * decision holds no files, and says why.
 */
const brokenBy = (
  move: Move,
  before: ProjectSnapshot,
  after: ProjectSnapshot
): readonly string[] => [
  ...after.proposals.flatMap((proposal) =>
    proposal.draft !== undefined &&
    DraftState.guards.Drafting(proposal.draft) &&
    proposal.draft.round === 1 &&
    decisionsFor(after, proposal).length > 0
      ? [`${proposal.id} has a decision while its first draft is drafting`]
      : []
  ),
  ...Option.match(
    Option.flatMap(
      Option.liftPredicate(move, Move.guards.Settle),
      ({ round, which }) =>
        Option.map(
          Option.fromUndefinedOr(before.proposals[which]),
          (proposal) => ({ proposal, round: settledRound(proposal, round) })
        )
    ),
    {
      onNone: (): readonly string[] => [],
      onSome: ({ proposal, round }) =>
        isCurrent(proposal, round) ||
        JSON.stringify([after.decisions, after.proposals, after.lastSeq]) ===
          JSON.stringify([before.decisions, before.proposals, before.lastSeq])
          ? []
          : [`a stale settle of ${proposal.id} round ${round} changed it`],
    }
  ),
  ...after.proposals.flatMap((proposal) => {
    if (
      proposal.state !== "open" ||
      proposal.draft === undefined ||
      DraftState.guards.Drafting(proposal.draft)
    ) {
      return [];
    }

    const decision = decisionsFor(after, proposal).at(-1);

    const says = (label: string) =>
      decision?.evidence.some((each) => each.label === label) === true;

    const held =
      decision !== undefined &&
      JSON.stringify(fileLabels(decision)) === JSON.stringify(proposal.files);

    if (DraftState.guards.Ready(proposal.draft)) {
      return held && says("red first")
        ? []
        : [`${proposal.id} is ready, and its decision holds other files`];
    }

    return held && says("draft failed") && !says("red first")
      ? []
      : [`${proposal.id}'s draft failed, and its decision says otherwise`];
  }),
];

const stored = ProjectStore.use((store) => store.load());

/** The drafted files composed onto main as it now stands, scripted red there. */
const redOnMain = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  const tip = LandedSha.make(
    Option.getOrThrow(Option.fromUndefinedOr(refs.get(mainRef)))
  );

  const composed = yield* composedAt(repo, tip, files);

  yield* CheckScript.use((checker) =>
    checker.script(composed, redThenGreen, ["failed", "failed"])
  );
});

/** One move, as a person or the platform makes it; a refusal is part of the history. */
const step = (api: ProjectApi, before: ProjectSnapshot, move: Move) => {
  const proposalAt = (which: number) =>
    Option.fromUndefinedOr(before.proposals[which]);

  return Move.match(move, {
    Accept: ({ which }) =>
      Option.match(
        Option.flatMap(proposalAt(which), (proposal) =>
          Array.findLast(
            decisionsFor(before, proposal),
            ({ decided }) => decided === undefined
          )
        ),
        {
          onNone: () => Effect.void,
          onSome: (decision) =>
            redOnMain.pipe(
              Effect.andThen(
                api.decide(person("alice"), {
                  choice: "accept",
                  decision: decision.id,
                })
              ),
              Effect.ignore
            ),
        }
      ),
    Expire: () =>
      TestClock.adjust(Duration.days(15)).pipe(Effect.andThen(api.onAlarm())),
    Propose: () =>
      Effect.ignore(
        api.proposeAsk(person("carol"), {
          draft: true,
          territory: "packages/parser",
          want: "Parse an ISO week date",
        })
      ),
    Redraft: ({ which, who }) =>
      Option.match(proposalAt(which), {
        onNone: () => Effect.void,
        onSome: (proposal) =>
          Effect.ignore(api.draftAsk(person(who), { proposal: proposal.id })),
      }),
    Settle: ({ red: isRed, round, which }) =>
      Option.match(proposalAt(which), {
        onNone: () => Effect.void,
        onSome: (proposal) =>
          api.draftSettled(
            proposal.id,
            settledRound(proposal, round),
            isRed ? red : failed
          ),
      }),
  });
};

/** Runs a history over a fresh project; returns its first bad step and what it broke. */
const firstBreak = (history: readonly Move[]) =>
  Effect.gen(function* () {
    yield* advanceTo("2026-10-08T12:00:00Z");

    const api = yield* projectService(project);

    yield* api.initProject(person("alice"), {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    yield* api.recordFirstPush(person("alice"), first);

    for (const [index, move] of history.entries()) {
      const before = yield* stored;

      yield* step(api, before, move);

      const broken = brokenBy(move, before, yield* stored);

      if (broken.length > 0) {
        return [`step ${index} (${move._tag})`, ...broken];
      }
    }

    return [];
  }).pipe(Effect.provide(worldOf(scenario, "memory")));

/**
 * Each history runs the project service over the memory world, a project
 * made fresh: a few hundred milliseconds on an idle machine, more while
 * turbo runs every package's tests at once. The limit catches a hang.
 */
const generated = { timeout: 120_000 };

describe("drafting, over generated histories", generated, () => {
  it.effect.prop(
    "keeps every invariant after every step",
    { history: histories },
    ({ history }) =>
      Effect.map(firstBreak(history), (broken) => {
        assert.deepStrictEqual(broken, [], broken.join("; "));
      }),
    { arbitrary: { runs: 200, size: 40 }, timeout: 120_000 }
  );
});
