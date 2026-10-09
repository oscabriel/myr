import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import type { CheckAt } from "@repo/checks/check-runner";
import { parseTrailers } from "@repo/git/trailers";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Glob } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { DraftState } from "@repo/protocol/domain/proposal";
import {
  AskId,
  DecisionId,
  LandedSha,
  LaneName,
  ProposalId,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import {
  CapReached,
  DraftInProgress,
  NotDecider,
  NotRedFirst,
  ProposalClosed,
  UnknownProposal,
} from "@repo/protocol/refusal";
import { advanceTo, at as instant } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Context, Effect, Layer, Option, Ref } from "effect";

import { DraftResult, DraftRuns } from "../src/draft-runs.ts";
import type { DraftParams } from "../src/draft-runs.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

/** datekit, decided by alice alone, with one `fix` ask carol may want. */
const scenario = aProject({ people: ["carol", "dave"] }).pipe(
  withVouches(["carol", "dave"]),
  withAsk({ id: "parse-week", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(project);

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

const alice = person("alice");

const carol = person("carol");

const dave = person("dave");

const anyone = Anonymous.make({});

const redThenGreen = LaneName.make("redThenGreen");

const model = "@cf/moonshotai/kimi-k2.7-code";

const noon = instant("2026-10-08T12:00:00Z");

const want = "Parse an ISO week date such as 2026-W41";

const proposal = ProposalId.make("prop-000001");

const ask = Option.getOrThrow(
  Array.findFirst(scenario.policy.asks, ({ id }) => id === "parse-week")
);

const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

const testPath = CheckSpec.guards.RedThenGreen(ask.check)
  ? ask.check.path
  : RepoPath.make("packages/parser/test/week.test.ts");

const askSource = `export default "parse-week";\n`;

const testSource = `import { parseWeek } from "../src/parse.ts";\n`;

/** The drafted ask's files: its ask file and its failing test. */
const files = Array.make(
  { content: askSource, path: ask.file },
  { content: testSource, path: testPath }
);

const red = (attempts = 2) =>
  DraftResult.cases.Red.make({
    attempts,
    files,
    lane: redThenGreen,
    model,
    rationale: "parseWeek is missing, so the test fails by its assertion",
    signature: "redThenGreen: scripted failure",
  });

const failed = DraftResult.cases.Failed.make({
  attempts: 3,
  model,
  refusal: new NotRedFirst({}),
});

const mainRef = RefName.make("refs/heads/main");

/** Every draft run the project started, in order. */
class Started extends Context.Service<
  Started,
  { readonly runs: Effect.Effect<readonly DraftParams[]> }
>()("test/Started") {}

/** `DraftRuns` that records each run it is asked to start. */
const recorded = Layer.effectContext(
  Effect.gen(function* () {
    const started = yield* Ref.make<readonly DraftParams[]>([]);

    return Context.make(DraftRuns, {
      start: (params) => Ref.update(started, (all) => [...all, params]),
    }).pipe(Context.add(Started, { runs: Ref.get(started) }));
  })
);

const world = Layer.mergeAll(worldOf(scenario, "memory"), recorded);

/** alice makes datekit; carol proposes the want with a draft. */
const proposed = Effect.gen(function* () {
  yield* advanceTo("2026-10-08T12:00:00Z");

  const api: ProjectApi = yield* projectService(project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  yield* api.recordFirstPush(alice, first);

  const made = yield* api.proposeAsk(carol, {
    draft: true,
    territory: "packages/parser",
    want,
  });

  return { api, first: LandedSha.make(first), made };
});

const stored = ProjectStore.use((store) => store.load());

const openProposalDecisions = Effect.map(stored, ({ decisions }) =>
  decisions.filter(({ subject }) =>
    DecisionSubject.guards.OpenProposal(subject)
  )
);

const runs = Started.use(({ runs: all }) => all);

/** The drafted files composed onto main, their check scripted red there. */
const redOnMain = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  const tip = LandedSha.make(
    Option.getOrThrow(Option.fromUndefinedOr(refs.get(mainRef)))
  );

  const composed: CheckAt = yield* composedAt(repo, tip, files);

  yield* CheckScript.use((checker) =>
    checker.script(composed, redThenGreen, ["failed", "failed"])
  );
});

const firstDecision = DecisionId.make("dec-000001");

/** datekit as above, with dave deciding the parser beside alice. */
const parserByDave = {
  policy: {
    ...scenario.policy,
    deciders: [
      ...scenario.policy.deciders,
      {
        handles: Array.make(dave.handle),
        paths: Glob.make("packages/parser/**"),
      },
    ],
  },
};

describe("a proposal with a draft", () => {
  it.effect("puts up no decision, and starts one draft run", () =>
    Effect.gen(function* () {
      const { api, made } = yield* proposed;

      expect(made.proposal).toStrictEqual({
        draft: DraftState.cases.Drafting.make({ round: 1, startedAt: noon }),
        expiresAt: instant("2026-10-22T12:00:00Z"),
        files: [],
        id: proposal,
        openedAt: noon,
        project,
        proposer: carol.handle,
        state: "open",
        territory: "packages/parser",
        want,
      });
      expect({
        decisions: yield* openProposalDecisions,
        opened: (yield* api.events(0, 100)).flatMap(({ event }) =>
          ProjectEvent.guards.ProposalOpened(event) ? [event.proposal] : []
        ),
        // The run's row ran, and is gone.
        outbox: (yield* stored).outbox,
        runs: yield* runs,
        today: (yield* api.today(alice)).decisions,
      }).toStrictEqual({
        decisions: [],
        opened: [proposal],
        outbox: [],
        runs: [{ project, proposal, round: 1 }],
        today: [],
      });
    }).pipe(Effect.provide(world))
  );

  it.effect(
    "settled red, puts up one decision with both files, its red first and who drafted it",
    () =>
      Effect.gen(function* () {
        const { api } = yield* proposed;

        yield* api.draftSettled(proposal, 1, red());

        const decisions = yield* openProposalDecisions;
        const shown = yield* api.showProposal(anyone, proposal);

        expect(
          decisions.map(({ deciders, evidence, subject }) => ({
            deciders,
            evidence,
            subject,
          }))
        ).toStrictEqual([
          {
            deciders: [alice.handle],
            evidence: [
              { label: "want", value: want },
              { label: "territory", value: "packages/parser" },
              { label: ask.file, value: askSource },
              { label: testPath, value: testSource },
              {
                label: "red first",
                value: "redThenGreen: redThenGreen: scripted failure",
              },
              { label: "drafted by", value: `${model}, attempt 2 of 3` },
              {
                label: "why this test",
                value:
                  "parseWeek is missing, so the test fails by its assertion",
              },
            ],
            subject: DecisionSubject.cases.OpenProposal.make({ proposal }),
          },
        ]);
        expect(shown).toStrictEqual({
          files,
          proposal: {
            ...shown.proposal,
            draft: DraftState.cases.Ready.make({
              attempts: 2,
              model,
              red: {
                lane: redThenGreen,
                signature: "redThenGreen: scripted failure",
              },
              round: 1,
            }),
            files: [ask.file, testPath],
          },
        });
        expect(
          (yield* api.events(0, 100)).flatMap(({ event }) =>
            ProjectEvent.guards.ProposalDrafted(event)
              ? [[event.proposal, event.ready]]
              : []
          )
        ).toStrictEqual([[proposal, true]]);
      }).pipe(Effect.provide(world))
  );

  it.effect("settled twice, changes nothing the second time", () =>
    Effect.gen(function* () {
      const { api } = yield* proposed;

      yield* api.draftSettled(proposal, 1, red());

      const once = yield* stored;

      yield* api.draftSettled(proposal, 1, red(3));

      const twice = yield* stored;

      expect([twice.decisions, twice.proposals, twice.lastSeq]).toStrictEqual([
        once.decisions,
        once.proposals,
        once.lastSeq,
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect("settled for round 1 after round 2 started, changes nothing", () =>
    Effect.gen(function* () {
      const { api } = yield* proposed;

      yield* api.draftSettled(proposal, 1, failed);
      yield* api.draftAsk(carol, { note: "use UTC", proposal });

      const drafting = yield* stored;

      yield* api.draftSettled(proposal, 1, red());

      const after = yield* stored;

      expect([after.decisions, after.proposals]).toStrictEqual([
        drafting.decisions,
        drafting.proposals,
      ]);
      expect(after.proposals.map(({ draft }) => draft)).toStrictEqual([
        DraftState.cases.Drafting.make({ round: 2, startedAt: noon }),
      ]);
      expect(yield* runs).toStrictEqual([
        { project, proposal, round: 1 },
        { note: "use UTC", project, proposal, round: 2 },
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect(
    "settled failed, puts up its want alone, with why the draft failed",
    () =>
      Effect.gen(function* () {
        const { api } = yield* proposed;

        yield* api.draftSettled(proposal, 1, failed);

        const decisions = yield* openProposalDecisions;
        const shown = yield* api.showProposal(anyone, proposal);

        expect(decisions.map(({ evidence }) => evidence)).toStrictEqual([
          [
            { label: "want", value: want },
            { label: "territory", value: "packages/parser" },
            {
              label: "draft failed",
              value:
                "NotRedFirst: the ask's check must fail on main twice in the same way, by an assertion",
            },
          ],
        ]);
        expect([shown.files, shown.proposal.draft]).toStrictEqual([
          [],
          DraftState.cases.Failed.make({
            attempts: 3,
            model,
            refusal: "NotRedFirst",
            round: 1,
          }),
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "accepted once ready, lands its ask asked by its proposer, decided by the decider, and assisted by the drafter",
    () =>
      Effect.gen(function* () {
        const { api } = yield* proposed;

        yield* api.draftSettled(proposal, 1, red());
        yield* redOnMain;
        yield* api.decide(alice, { choice: "accept", decision: firstDecision });

        const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

        const tip = Option.getOrThrow(
          Option.fromUndefinedOr(refs.get(mainRef))
        );

        const read = yield* (yield* RepoHost)
          .readCommit(repo, tip)
          .pipe(Effect.orDie);

        const trailers = parseTrailers(Option.getOrThrow(read).message);
        const { landings, proposals } = yield* stored;

        expect(
          trailers.filter(({ key }) =>
            [
              "Asked-by",
              "Decided-by",
              "Assisted-by",
              "Signed-off-by",
              "Answered-by",
            ].includes(key)
          )
        ).toStrictEqual([
          {
            key: "Asked-by",
            value: `${carol.handle} <${carol.handle}@users.${Brand.domain}>`,
          },
          {
            key: "Decided-by",
            value: `${alice.handle} <${alice.handle}@users.${Brand.domain}>`,
          },
          {
            key: "Assisted-by",
            value: `${Brand.cli}-drafter:${model} (verified)`,
          },
        ]);
        // Beside alice's first push, the landing that opened the ask.
        expect(
          landings
            .filter(({ sha }) => sha === tip)
            .map(({ assisted, credits }) => ({ assisted, credits }))
        ).toStrictEqual([
          {
            assisted: [
              { harness: `${Brand.cli}-drafter`, model, verified: true },
            ],
            credits: [
              { handle: carol.handle, role: "Asked-by" },
              { handle: alice.handle, role: "Decided-by" },
            ],
          },
        ]);
        expect(proposals.map(({ state }) => state)).toStrictEqual(["accepted"]);
        expect(
          (yield* api.listAsks(anyone)).asks.map((listing) => listing.ask)
        ).toStrictEqual([AskId.make("parse-week")]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "drafted again is refused while drafting, for someone neither proposer nor decider, once closed, and past three rounds",
    () =>
      Effect.gen(function* () {
        const { api } = yield* proposed;

        const drafting = yield* api
          .draftAsk(carol, { proposal })
          .pipe(Effect.flip);

        yield* api.draftSettled(proposal, 1, failed);

        const outsider = yield* api
          .draftAsk(dave, { proposal })
          .pipe(Effect.flip);

        const unknown = yield* api
          .draftAsk(carol, { proposal: ProposalId.make("prop-000009") })
          .pipe(Effect.flip);

        const second = yield* api.draftAsk(alice, { proposal });

        yield* api.draftSettled(proposal, 2, failed);
        yield* api.draftAsk(carol, { proposal });
        yield* api.draftSettled(proposal, 3, red());

        const fourth = yield* api
          .draftAsk(carol, { proposal })
          .pipe(Effect.flip);

        yield* redOnMain;
        yield* api.decide(alice, { choice: "accept", decision: firstDecision });

        const closed = yield* api
          .draftAsk(carol, { proposal })
          .pipe(Effect.flip);

        expect([drafting, outsider, unknown, fourth, closed]).toStrictEqual([
          DraftInProgress.of(proposal),
          new NotDecider({}),
          new UnknownProposal({ proposal: ProposalId.make("prop-000009") }),
          new CapReached({ cap: 3 }),
          new ProposalClosed({ proposal }),
        ]);
        expect(second.proposal.draft).toStrictEqual(
          DraftState.cases.Drafting.make({ round: 2, startedAt: noon })
        );
        expect(yield* openProposalDecisions).toHaveLength(1);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "gives its run what it drafts from: the landed commit, the want and the public policy",
    () =>
      Effect.gen(function* () {
        const { api, first } = yield* proposed;
        const context = yield* api.draftContext(proposal, 1);

        const unknown = yield* api
          .draftContext(ProposalId.make("prop-000009"), 1)
          .pipe(Effect.flip);

        expect({ ...context, policy: "policy" in context }).toStrictEqual({
          at: first,
          paths: [
            RepoPath.make("package.json"),
            RepoPath.make("packages/parser/src/parse.ts"),
          ],
          policy: true,
          project,
          proposal,
          round: 1,
          territory: "packages/parser",
          want,
        });
        expect("visibility" in context.policy).toBeFalsy();
        expect(context.policy.deciders).toStrictEqual(scenario.policy.deciders);
        expect(unknown).toStrictEqual(
          new UnknownProposal({ proposal: ProposalId.make("prop-000009") })
        );
      }).pipe(Effect.provide(world))
  );
  it.effect(
    "drafted again into files another decider decides, puts the open decision to them too",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-08T12:00:00Z");

        const api = yield* projectService(project);

        yield* api.initProject(alice, {});

        const first = yield* Pusher.use((pusher) =>
          pusher.push(repo, Option.none(), start, "Start")
        );

        yield* api.recordFirstPush(alice, first);
        // No territory: the files a draft holds say whose the decision is.
        yield* api.proposeAsk(carol, { draft: true, want });
        yield* api.draftSettled(proposal, 1, failed);

        const wantOnly = yield* openProposalDecisions;

        yield* api.draftAsk(carol, { proposal });
        yield* api.draftSettled(proposal, 2, red());

        const drafted = yield* openProposalDecisions;

        expect(
          [wantOnly, drafted].map((decisions) =>
            decisions.map(({ deciders, id }) => ({ deciders, id }))
          )
        ).toStrictEqual([
          [{ deciders: [alice.handle], id: firstDecision }],
          [{ deciders: [alice.handle, dave.handle], id: firstDecision }],
        ]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(worldOf(parserByDave, "memory"), recorded)
        )
      )
  );
});
