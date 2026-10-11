import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import { CheckAt, shaOf } from "@repo/checks/check-runner";
import type { CheckRunner } from "@repo/checks/check-runner";
import { logRefOf } from "@repo/checks/evidence-store";
import type { EvidenceStore } from "@repo/checks/evidence-store";
import { EvidenceKept } from "@repo/checks/evidence-store/memory";
import {
  AnswerReport,
  ReportedCommand,
  Steps,
} from "@repo/project/answer-runs";
import { drive } from "@repo/project/answer-runs/steps";
import type { Lander } from "@repo/project/lander";
import { LanderJob } from "@repo/project/lander/memory";
import { Projects } from "@repo/project/projects";
import { Verdict } from "@repo/protocol/domain/answer";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import { keyOf, LaneName, RequestId } from "@repo/protocol/ids";
import type { CommitSha, LandedSha } from "@repo/protocol/ids";
import {
  ChecksFailed,
  Flake,
  StaleBase,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import { DateTime, Effect, Exit, Layer, Option, Schema, Struct } from "effect";
import type { Context } from "effect";

import type { AnswerParams } from "../../src/answer-runs.ts";
import {
  Answer,
  OutcomeJson,
  runWorkflow,
} from "../../src/workflows/answer.ts";
import { failingPathsOf } from "../../src/workflows/answer/lanes.ts";
import { runAnswer } from "../../src/workflows/answer/program.ts";
import { memoSteps } from "../../src/workflows/step.ts";
import type { StepRunner, WorkflowSteps } from "../../src/workflows/step.ts";
import { fakeEnv } from "../fake-env.ts";
import {
  admitted,
  alice,
  askLane,
  bob,
  bobFork,
  changed,
  Checker,
  DoCalls,
  finishRequired,
  LanderCalls,
  lexPath,
  logged,
  mainMoved,
  mainTip,
  openedFiles,
  parseIso,
  parsePath,
  policy,
  project,
  repo,
  scriptProjectLanes,
  Started,
  StepLog,
  verdictOf,
  world,
  worldWith,
} from "./answer.fixtures.ts";
import type { Admitted } from "./answer.fixtures.ts";

const unit = LaneName.make("unit");

const lint = LaneName.make("lint");

/** One `advanceAnswer` call as it crosses the Durable Object's boundary. */
const Advance = Schema.toCodecJson(
  Schema.Struct({
    command: ReportedCommand,
    report: Schema.UndefinedOr(AnswerReport),
  })
);

/** The program run for `answer`, over `steps`. */
const run = (answer: Admitted, steps: Context.Context<StepRunner>) =>
  runAnswer({ project, requestId: answer.requestId }).pipe(
    Effect.provide(steps)
  );

/** Steps over a fresh in-memory record, each name asked for logged. */
const freshSteps = (options: { readonly twice?: boolean } = {}) =>
  Effect.flatMap(memoSteps(), (memo) => Layer.build(logged(memo, options)));

/** Every step name `steps` was asked for, in order. */
const namesOf = (steps: Context.Context<StepLog>) =>
  StepLog.use(({ names }) => names).pipe(Effect.provide(steps));

/** The steps of one pass from merge to land, after the run's `load`. */
const pass = (attempt: number) => [
  `merge#${attempt}`,
  `record:merge#${attempt}`,
  `cheap#${attempt}`,
  `checks#${attempt}`,
  `record:checks#${attempt}`,
  `land#${attempt}`,
  `record:land#${attempt}`,
];

/** Every lane on `at` passes: the ask's check and every project lane. */
const allGreen = (at: CheckAt) =>
  Effect.andThen(
    scriptProjectLanes(at, { result: "passed" }),
    Checker.use((script) => script.script(at, askLane, [{ result: "passed" }]))
  );

/** `lane` fails on the merged tree, saying `signature`, and ends `onMain` on main. */
const failsOnMerged = (
  answer: Admitted,
  lane: LaneName,
  signature: string,
  onMain: "passed" | "failed"
) =>
  Effect.gen(function* () {
    yield* allGreen(answer.merged);
    yield* Checker.use((script) =>
      Effect.andThen(
        script.script(answer.merged, lane, [{ result: "failed", signature }]),
        script.script(
          CheckAt.cases.Commit.make({ commit: answer.opened }),
          lane,
          [{ result: onMain }]
        )
      )
    );
  });

/** The Checker's jobs on `at`: their lanes, and the repo each ran in. */
const jobsOn = (at: CheckAt) =>
  Checker.use(({ jobs }) =>
    Effect.map(jobs, (all) =>
      all
        .filter((job) => shaOf(job.at) === shaOf(at))
        .map(({ lanes, repo: on }) => ({ lanes, on }))
    )
  );

/** The lands of `answer` the Lander was asked for. */
const landsOf = (answer: Admitted) =>
  LanderCalls.use(({ jobs }) =>
    Effect.map(jobs, (all) =>
      all.filter(
        (each) =>
          LanderJob.$is("Land")(each) && each.job.requestId === answer.requestId
      )
    )
  );

/** What each `advanceAnswer` call reported, by tag. */
const reportedTags = DoCalls.use(({ advances }) =>
  Effect.map(advances, (all) => all.map(({ command }) => command._tag))
);

const parentsOf = (sha: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const read = yield* host.readCommit(repo, sha).pipe(Effect.orDie);

    return Option.getOrThrow(read).parents;
  });

const landedAt = (sha: LandedSha) => Outcome.cases.Landed.make({ sha });

/** A clean answer, admitted, its lanes all green on the merged tree. */
const cleanAnswer = Effect.tap(admitted(), (answer) => allGreen(answer.merged));

/**
 * The world's projects, each answer's run handed on without its landing
 * message: a run that holds the landing slot, but whose land no step can
 * make.
 */
const withoutMessage = Layer.effect(
  Projects,
  Effect.map(Projects, (inner) =>
    Projects.of({
      create: inner.create,
      get: (name) =>
        Effect.map(inner.get(name), (api) => ({
          ...api,
          answer: (requestId) =>
            Effect.map(
              api.answer(requestId),
              Option.map((found) => Struct.omit(found, ["message"]))
            ),
        })),
    })
  )
);

describe(runAnswer, () => {
  it.effect(
    "1. a clean answer is merged, checked and landed, one named step at a time",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;
        const steps = yield* freshSteps();
        const outcome = yield* run(answer, steps);
        const tip = yield* mainTip;

        expect(outcome).toStrictEqual(landedAt(tip));
        expect(yield* parentsOf(tip)).toStrictEqual([answer.opened]);
        expect(yield* namesOf(steps)).toStrictEqual([
          "load",
          ...pass(1),
          "notes:Landed",
        ]);
        expect(yield* landsOf(answer)).toHaveLength(1);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "1. the project records each step's report and the landing, through its queue",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;
        const outcome = yield* run(answer, yield* freshSteps());
        const { answers } = yield* answer.api.status(bob);

        expect(yield* reportedTags).toStrictEqual([
          "Merged",
          "Checked",
          "LandedOk",
        ]);
        expect(answers.map((each) => each.outcome)).toStrictEqual([outcome]);
        expect(
          Option.map(yield* verdictOf(answer.api), (v) => v.tree)
        ).toStrictEqual(Option.some(shaOf(answer.merged)));
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "1. the checks run on the exact merged tree, in the fork that holds it, the cheap lanes first",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;

        yield* run(answer, yield* freshSteps());

        const jobs = yield* Checker.use((script) => script.jobs);

        // Each in the project's own setup, its run block (live on
        // dev-oscabriel: a job without one is blocked).
        expect(
          jobs
            .filter(({ at }) => CheckAt.guards.Tree(at))
            .map(({ at, lanes, repo: on, run: block }) => ({
              at,
              lanes: lanes.map(({ lane }) => lane),
              on,
              run: block,
            }))
        ).toStrictEqual([
          {
            at: answer.merged,
            lanes: ["lint", "types"],
            on: bobFork,
            run: policy.run,
          },
          {
            at: answer.merged,
            lanes: [askLane, "unit"],
            on: bobFork,
            run: policy.run,
          },
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "2. the whole program run twice over one step record lands once, with one outcome",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;
        const steps = yield* freshSteps();
        const first = yield* run(answer, steps);
        const second = yield* run(answer, steps);

        expect(second).toStrictEqual(first);
        expect(yield* landsOf(answer)).toHaveLength(1);
        expect(yield* reportedTags).toStrictEqual([
          "Merged",
          "Checked",
          "LandedOk",
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "2. every step's effect run twice still lands once, with the same outcome",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;
        const outcome = yield* run(answer, yield* freshSteps({ twice: true }));
        const tip = yield* mainTip;
        const events = yield* answer.api.events(0, 1000);

        expect(outcome).toStrictEqual(landedAt(tip));
        expect(yield* parentsOf(tip)).toStrictEqual([answer.opened]);
        expect(
          events.filter(
            ({ event }) =>
              ProjectEvent.guards.Landed(event) &&
              event.landing.requestId === answer.requestId
          )
        ).toHaveLength(1);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "3. a lane red on the merged tree and green on main, in a file the answer changed, is the answer's failure",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* failsOnMerged(
          answer,
          unit,
          `parses ISO weeks: AssertionError: expected {} to equal { year: 2026 } at ${parsePath}:1:22`,
          "passed"
        );

        const steps = yield* freshSteps();
        const outcome = yield* run(answer, steps);

        expect(outcome).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [
              new ChecksFailed({
                lane: unit,
                logRef: `${keyOf(project)}/${answer.requestId}/unit#1`,
                next: "bun run test",
              }),
            ],
          })
        );
        expect(yield* namesOf(steps)).toContain(`main:${answer.opened}:unit`);
        expect(
          yield* jobsOn(CheckAt.cases.Commit.make({ commit: answer.opened }))
        ).toStrictEqual([
          { lanes: [{ command: "bun run test", lane: unit }], on: repo },
        ]);
        expect(yield* landsOf(answer)).toHaveLength(0);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "3. a lane red on the merged tree and on main is the verifier's trouble",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* failsOnMerged(answer, unit, "AssertionError: red", "failed");

        expect(yield* run(answer, yield* freshSteps())).toStrictEqual(
          Outcome.cases.Refused.make({ refusals: [new VerifierBlocked({})] })
        );
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "3. a lane red only in a file outside the answer's diff, and green on main, means a stale base",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* failsOnMerged(
          answer,
          unit,
          `lexes words: AssertionError: expected 2 to be 3 at ${lexPath}:1:30`,
          "passed"
        );

        expect(yield* run(answer, yield* freshSteps())).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [
              new StaleBase({
                base: answer.opened,
                conflicts: [],
                main: answer.opened,
              }),
            ],
          })
        );
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "3. a lane that never got going runs once more on the merged tree, and green then is a flake",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* allGreen(answer.merged);
        yield* Checker.use((script) =>
          script.script(answer.merged, unit, [
            { result: "flaked" },
            { result: "passed" },
          ])
        );

        expect(yield* run(answer, yield* freshSteps())).toStrictEqual(
          Outcome.cases.Refused.make({ refusals: [new Flake({ lane: unit })] })
        );
        expect(
          (yield* jobsOn(answer.merged)).map(({ lanes, on }) => ({
            lanes: lanes.map(({ lane }) => lane),
            on,
          }))
        ).toStrictEqual([
          { lanes: [lint, "types"], on: bobFork },
          { lanes: [askLane, unit], on: bobFork },
          { lanes: [unit], on: bobFork },
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "3. a lane that never got going and then fails on its fresh run is the answer's failure",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* failsOnMerged(answer, unit, "AssertionError: red", "passed");
        yield* Checker.use((script) =>
          script.script(answer.merged, unit, [
            { result: "blocked" },
            {
              result: "failed",
              signature: `AssertionError: expected {} to equal { year: 2026 } at ${parsePath}:1:22`,
            },
          ])
        );

        expect(yield* run(answer, yield* freshSteps())).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [
              new ChecksFailed({
                lane: unit,
                logRef: `${keyOf(project)}/${answer.requestId}/unit#1`,
                next: "bun run test",
              }),
            ],
          })
        );
      }).pipe(Effect.provide(world))
  );

  it.effect("3. a red cheap lane refuses before the costlier checks run", () =>
    Effect.gen(function* () {
      const answer = yield* admitted();

      yield* failsOnMerged(answer, lint, "lint: no-unused-vars", "passed");

      const steps = yield* freshSteps();

      expect(yield* run(answer, steps)).toStrictEqual(
        Outcome.cases.Refused.make({
          refusals: [
            new ChecksFailed({
              lane: lint,
              logRef: `${keyOf(project)}/${answer.requestId}/lint#1`,
              next: "bun run lint",
            }),
          ],
        })
      );
      expect(yield* namesOf(steps)).not.toContain("checks#1");
    }).pipe(Effect.provide(world))
  );

  it.effect(
    "4. a land that finds main moved is merged again, checked again on the new tree, and lands",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;

        const moved = yield* mainMoved(
          answer.opened,
          changed(
            openedFiles,
            lexPath,
            "export const lex = (s) => s.split(/ +/);\n"
          )
        );

        const remerged = yield* LanderCalls.use(({ preview }) =>
          preview({
            base: answer.opened,
            fork: bobFork,
            head: answer.head,
            main: moved,
            repo,
          })
        );

        yield* allGreen(remerged);

        const steps = yield* freshSteps();
        const outcome = yield* run(answer, steps);
        const tip = yield* mainTip;

        expect(outcome).toStrictEqual(landedAt(tip));
        expect(yield* parentsOf(tip)).toStrictEqual([moved]);
        expect(yield* namesOf(steps)).toStrictEqual([
          "load",
          ...pass(1),
          ...pass(2),
          "notes:Landed",
        ]);
        expect(
          Option.map(yield* verdictOf(answer.api), ({ tree }) => tree)
        ).toStrictEqual(Option.some(shaOf(remerged)));
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "4. a land that finds main moved, whose re-merge conflicts, is refused as stale",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;

        const moved = yield* mainMoved(
          answer.opened,
          changed(openedFiles, parsePath, "export const parse = (s) => null;\n")
        );

        expect(yield* run(answer, yield* freshSteps())).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [
              new StaleBase({
                base: answer.opened,
                conflicts: [parsePath],
                main: moved,
              }),
            ],
          })
        );
        expect(yield* mainTip).toBe(moved);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "5. a busy repo is retried by the land step's own retries, not refused",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;

        yield* LanderCalls.use(({ busyFor }) => busyFor(1));

        const steps = yield* freshSteps();
        const outcome = yield* run(answer, steps);

        const retries = yield* StepLog.use((log) => log.retries).pipe(
          Effect.provide(steps)
        );

        expect(outcome).toStrictEqual(landedAt(yield* mainTip));
        expect(yield* landsOf(answer)).toHaveLength(2);
        expect(yield* reportedTags).toStrictEqual([
          "Merged",
          "Checked",
          "LandedOk",
        ]);
        expect(Option.fromUndefinedOr(retries.get("land#1"))).toStrictEqual(
          Option.some({ backoff: "exponential", delayMs: 1000, limit: 3 })
        );
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "5. a repo still busy once the retries are spent waits on the project's own retry",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;

        yield* LanderCalls.use(({ busyFor }) => busyFor(100));

        expect(yield* run(answer, yield* freshSteps())).toStrictEqual(
          Outcome.cases.Checking.make({ stage: "human" })
        );
        expect(yield* reportedTags).toStrictEqual([
          "Merged",
          "Checked",
          "Busy",
        ]);
        expect(yield* mainTip).toBe(answer.opened);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "a land step that finds nothing to do ends the run there, as the in-process run does",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;
        const steps = yield* freshSteps();

        const exit = yield* Effect.exit(
          run(answer, steps).pipe(Effect.provide(withoutMessage))
        );

        expect(Exit.getSuccess(exit)).toStrictEqual(
          Option.some(Outcome.cases.Checking.make({ stage: "human" }))
        );
        expect(yield* namesOf(steps)).toStrictEqual([
          "load",
          ...pass(1),
          "notes:Checking",
        ]);
        expect(yield* landsOf(answer)).toHaveLength(0);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "an answer a decider must finish stops once checked, and lands nothing",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;
        const steps = yield* freshSteps();

        expect(yield* run(answer, steps)).toStrictEqual(
          Outcome.cases.AwaitingFinish.make({})
        );
        expect(yield* namesOf(steps)).toStrictEqual([
          "load",
          "merge#1",
          "record:merge#1",
          "cheap#1",
          "checks#1",
          "record:checks#1",
          "notes:AwaitingFinish",
        ]);
        expect(yield* landsOf(answer)).toHaveLength(0);
      }).pipe(Effect.provide(worldWith(finishRequired)))
  );

  it.effect(
    "a decider's finish starts the answer's run again, and a fresh run lands it, finished",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;

        yield* run(answer, yield* freshSteps());

        yield* answer.api.finish(alice, {
          ask: parseIso,
          base: answer.opened,
          head: answer.head,
          requestId: RequestId.make(`finish-${answer.head}`),
        });

        const outcome = yield* run(answer, yield* freshSteps());
        const tip = yield* mainTip;
        const events = yield* answer.api.events(0, 1000);

        expect(yield* Started.use(({ ids }) => ids)).toStrictEqual([
          answer.requestId,
          answer.requestId,
        ]);
        expect(outcome).toStrictEqual(landedAt(tip));
        expect(
          events.flatMap(({ event: each }) =>
            ProjectEvent.guards.Landed(each)
              ? each.landing.credits.filter(
                  ({ role }) => role === "Finished-by"
                )
              : []
          )
        ).toStrictEqual([{ handle: alice.handle, role: "Finished-by" }]);
      }).pipe(Effect.provide(worldWith(finishRequired)))
  );

  it.effect(
    "6. a failing lane's log is kept once, and the verdict names it",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();
        const said = "AssertionError: expected {} to equal { year: 2026 }";

        yield* failsOnMerged(
          answer,
          unit,
          `parses ISO weeks: ${said}`,
          "passed"
        );

        const outcome = yield* run(answer, yield* freshSteps());
        const puts = yield* EvidenceKept.use((kept) => kept.puts);
        const verdict = yield* verdictOf(answer.api);

        const ref = logRefOf({
          attempt: 1,
          lane: unit,
          project,
          requestId: answer.requestId,
        });

        expect(
          puts.map((log) => ({
            ref: logRefOf(log),
            told: log.text.includes(said),
          }))
        ).toStrictEqual([{ ref, told: true }]);
        expect(outcome).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [
              new ChecksFailed({
                lane: unit,
                logRef: ref,
                next: "bun run test",
              }),
            ],
          })
        );
        expect(
          Option.map(verdict, ({ lanes, outcome: judged }) => ({
            judged,
            refs: lanes.map(({ logRef }) => logRef),
          }))
        ).toStrictEqual(
          Option.some({
            judged: outcome,
            refs: [undefined, undefined, undefined, ref],
          })
        );
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "6. a lane's log travels nowhere: not in the outcome, the verdict or the calls to the project",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();
        const said = "AssertionError: expected {} to equal { year: 2026 }";

        yield* failsOnMerged(
          answer,
          unit,
          `parses ISO weeks: ${said}`,
          "passed"
        );

        const outcome = yield* run(answer, yield* freshSteps());
        const verdict = Option.getOrThrow(yield* verdictOf(answer.api));
        const advances = yield* DoCalls.use((calls) => calls.advances);

        const travelled = JSON.stringify([
          yield* Schema.encodeEffect(OutcomeJson)(outcome),
          yield* Schema.encodeEffect(Schema.toCodecJson(Verdict))(verdict),
          yield* Effect.forEach(advances, (each) =>
            Schema.encodeEffect(Advance)(each)
          ),
        ]);

        expect(travelled).not.toContain(said);
        expect(travelled).toContain(
          logRefOf({
            attempt: 1,
            lane: unit,
            project,
            requestId: answer.requestId,
          })
        );
      }).pipe(Effect.provide(world))
  );

  it.effect("6. a check step run twice keeps its log under the same name", () =>
    Effect.gen(function* () {
      const answer = yield* admitted();

      yield* failsOnMerged(answer, unit, "AssertionError: red", "passed");
      yield* run(answer, yield* freshSteps({ twice: true }));

      const puts = yield* EvidenceKept.use((kept) => kept.puts);

      expect(puts.length).toBeGreaterThan(1);
      expect(new Set(puts.map(logRefOf))).toStrictEqual(
        new Set([
          logRefOf({
            attempt: 1,
            lane: unit,
            project,
            requestId: answer.requestId,
          }),
        ])
      );
    }).pipe(Effect.provide(world))
  );

  it.effect(
    "the in-process run reaches the same outcome as the Workflow's program",
    () =>
      Effect.gen(function* () {
        const viaProgram = yield* Effect.flatMap(cleanAnswer, (answer) =>
          Effect.flatMap(freshSteps(), (steps) => run(answer, steps))
        ).pipe(Effect.provide(world));

        const inProcess = yield* Effect.gen(function* () {
          const answer = yield* cleanAnswer;

          yield* drive(answer.api, answer.requestId);

          return (yield* answer.api.status(bob)).answers.map(
            ({ outcome }) => outcome
          );
        }).pipe(Effect.provide(world));

        expect(inProcess).toStrictEqual([viaProgram]);
      })
  );
});

describe(failingPathsOf, () => {
  it("names the repo files a failure points at, tests and absolute paths left out", () => {
    expect(
      failingPathsOf(
        [
          `lexes words: AssertionError: expected 2 to be 3 at ${lexPath}:1:30`,
          `    at packages/parser/test/parse-iso.test.ts:5:7`,
          "    at /home/ci/node_modules/vitest/dist/index.js:10:3",
          `    at (${parsePath}:3)`,
          `    at ${lexPath}:2:1`,
        ].join("\n")
      )
    ).toStrictEqual([lexPath, parsePath]);
  });

  it("reads no network address as a file", () => {
    expect(
      failingPathsOf(
        "serves: AssertionError: expected 'listening on 127.0.0.1:8080' to be 'up'"
      )
    ).toStrictEqual([]);
  });
});

/**
 * A Workflow engine in memory, as `step.test.ts` fakes one: a step's first
 * run records what its body returns under its name, and a replay returns
 * the record without running the body. It keeps the name of every step
 * whose body ran.
 */
const fakeEngine = () => {
  const recorded = new Map<string, Promise<Schema.Json>>();
  const ran: string[] = [];

  const steps: WorkflowSteps = {
    do: (name, _config, body) => {
      const kept = recorded.get(name);

      if (kept !== undefined) {
        return kept;
      }

      ran.push(name);

      const running = body();

      recorded.set(name, running);

      return running;
    },
  };

  /** What the engine recorded for `name`; `null` if no step of that name ran. */
  const record = (name: string) =>
    Effect.promise(() => recorded.get(name) ?? Promise.resolve(null));

  return { ran, record, steps };
};

/** Whether a value is plain JSON: no class instance, no `undefined`, no cycle. */
const isJson = Schema.is(Schema.Json);

/** The engine's event for one run of the Workflow. */
const event = (payload: typeof AnswerParams.Encoded) => ({
  instanceId: payload.requestId,
  payload,
  timestamp: DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-07T12:00:00Z")),
  workflowName: "answer-local",
});

/** The world's ports, as the Workflow's run takes them. */
const portsOfWorld = Effect.map(
  Effect.context<CheckRunner | EvidenceStore | Lander | Projects | RepoHost>(),
  Layer.succeedContext
);

describe(runWorkflow, () => {
  it.effect(
    "hands the engine each step's value as JSON, and returns the outcome as JSON",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;
        const engine = fakeEngine();
        const ports = yield* portsOfWorld;
        const payload = { project, requestId: answer.requestId };

        const outcome = yield* Effect.promise(() =>
          runWorkflow(ports, payload, engine.steps)
        );

        const tip = yield* mainTip;

        const recorded = yield* engine.record("record:land#1");

        expect(engine.ran).toStrictEqual(["load", ...pass(1), "notes:Landed"]);
        expect(isJson(outcome)).toBeTruthy();
        expect(yield* Schema.decodeEffect(OutcomeJson)(outcome)).toStrictEqual(
          landedAt(tip)
        );
        expect(isJson(recorded)).toBeTruthy();
        expect(
          yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Steps))(recorded)
        ).toStrictEqual({ effects: [], outcome: landedAt(tip) });
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "replays a run from the engine's records: nothing runs again, and the outcome is the same",
    () =>
      Effect.gen(function* () {
        const answer = yield* cleanAnswer;
        const engine = fakeEngine();
        const ports = yield* portsOfWorld;
        const payload = { project, requestId: answer.requestId };

        const first = yield* Effect.promise(() =>
          runWorkflow(ports, payload, engine.steps)
        );

        const ranOnce = [...engine.ran];

        const second = yield* Effect.promise(() =>
          runWorkflow(ports, payload, engine.steps)
        );

        expect(second).toStrictEqual(first);
        expect(engine.ran).toStrictEqual(ranOnce);
        expect(yield* landsOf(answer)).toHaveLength(1);
      }).pipe(Effect.provide(world))
  );
});

describe(Answer, () => {
  it.effect("refuses params that don't decode before any step runs", () =>
    Effect.gen(function* () {
      const engine = fakeEngine();
      const workflow = new Answer(untouchable("ctx"), fakeEnv());

      const exit = yield* Effect.exit(
        Effect.tryPromise(() =>
          workflow.run(
            event({ project: "Not A Project", requestId: "push-0001" }),
            engine.steps
          )
        )
      );

      expect(Exit.isFailure(exit)).toBeTruthy();
      expect(engine.ran).toStrictEqual([]);
    })
  );

  it.effect(
    "runs its first step over the engine's, on the ports its env builds",
    () =>
      Effect.gen(function* () {
        const engine = fakeEngine();
        const workflow = new Answer(untouchable("ctx"), fakeEnv());

        // The fake env's Project DOs hold no project: the first step finds none.
        const exit = yield* Effect.exit(
          Effect.tryPromise(() =>
            workflow.run(
              event({ project, requestId: "push-0001" }),
              engine.steps
            )
          )
        );

        expect(Exit.isFailure(exit)).toBeTruthy();
        expect(engine.ran).toStrictEqual(["load"]);
      })
  );
});
