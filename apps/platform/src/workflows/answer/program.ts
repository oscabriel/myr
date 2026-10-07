/**
 * The Answer Workflow's program (spec §5 steps 7–8): one admitted answer
 * carried to its verdict and onto main through its project's answer queue,
 * each port call a named durable step.
 *
 * The project decides; the program only runs what it asks for. It loads
 * the answer's run (`answer`), then runs each port call the run waits on
 * (`merge`, the `cheap` lanes and the `checks` on the merged tree, `land`)
 * as a step whose value is the `LandingCommand` that reports it, and
 * reports it in a `record` step (`advanceAnswer`), which returns the calls
 * to run next. Every call to the project happens inside a step, so a replay
 * of the whole run follows the same path and runs nothing twice; a step
 * whose effect ran twice reports twice, and the landing lifecycle takes the
 * second report as the replay it is. Step names carry their attempt
 * (`merge#2`), so a merge onto a main that moved is a new step, not a replay.
 *
 * The run stops when the answer lands, is refused, waits on a person or on
 * the landing slot, or must wait for a retry: the project starts it again
 * then. A busy repo during a land is retried by the land step's own
 * retries first. It also stops when a port step finds nothing to do (the
 * answer no longer waits on that call), as W2's in-process run does:
 * whatever moved the answer on carries it, and a run that went on from the
 * state it found could ask for the same call forever. Wherever it stops,
 * its last step writes the verdict, as it stands then, as the note on the
 * answer's head in its fork (`notes`).
 */
import { HostBusy } from "@repo/artifacts/repo-host";
import type { RepoHost } from "@repo/artifacts/repo-host";
import type { CheckRunner } from "@repo/checks/check-runner";
import type { EvidenceStore } from "@repo/checks/evidence-store";
import {
  AnswerReport,
  AnswerRun,
  NextStep,
  ReportedCommand,
  Steps,
} from "@repo/project/answer-runs";
import { nextSteps, runStep } from "@repo/project/answer-runs/steps";
import type { Lander } from "@repo/project/lander";
import {
  LandingCommand,
  LandingEffect,
  outcomeOf,
} from "@repo/project/landing";
import { Projects } from "@repo/project/projects";
import { LaneOutcome } from "@repo/protocol/domain/answer";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Outcome } from "@repo/protocol/domain/outcome";
import { CommitSha } from "@repo/protocol/ids";
import type { LaneName, ProjectName, RequestId } from "@repo/protocol/ids";
import {
  Array,
  Cause,
  Data,
  Effect,
  Match,
  Option,
  Schedule,
  Schema,
} from "effect";

import type { AnswerParams } from "../../answer-runs.ts";
import { writeVerdictNote } from "../notes.ts";
import { StepRunner } from "../step.ts";
import type { StepRetry } from "../step.ts";
import {
  laneOnMain,
  refusalsOf,
  runStage,
  StageRun,
  toCompareOnMain,
} from "./lanes.ts";
import type { Stage } from "./lanes.ts";

/** Every port the program runs on. */
export type AnswerPorts =
  | CheckRunner
  | EvidenceStore
  | Lander
  | Projects
  | RepoHost
  | StepRunner;

/** A run was started for a request its project does not hold: the project never does that. */
export class UnknownRequest extends Data.TaggedError("UnknownRequest")<{
  readonly project: ProjectName;
  readonly requestId: RequestId;
}> {}

/** A land found the repo busy, at the landing's attempt: the land step's retries take it. */
class LandBusy extends Data.TaggedError("LandBusy")<{
  readonly attempt: number;
}> {}

/** How a land step retries a busy repo before the project's own retry takes over. */
export const landRetry: StepRetry = {
  backoff: "exponential",
  delayMs: 1000,
  limit: 3,
};

/** What a port step came to: the command that reports it, and what it saw beside it. */
export const Reported = Schema.Struct({
  command: ReportedCommand,
  report: Schema.optionalKey(AnswerReport),
});

export type Reported = typeof Reported.Type;

/** A port step's value: `None` when the answer no longer waits on that call. */
const Reporting = Schema.Option(Reported);

type NextStep = typeof NextStep.Type;

type Steps = typeof Steps.Type;

type Call<Tag extends NextStep["_tag"]> = Extract<
  NextStep,
  { readonly _tag: Tag }
>;

/** How many times each port call has run in this run: the attempt in a step's name. */
interface Attempts {
  readonly Land: number;
  readonly Merge: number;
  readonly RunChecks: number;
}

const reported = (
  command: LandingCommand,
  report?: AnswerReport
): Option.Option<Reported> =>
  Option.some(report === undefined ? { command } : { command, report });

/** The port calls among a landing's effects, as a run hands them on. */
const callsOf = (effects: readonly LandingEffect[]): readonly NextStep[] =>
  effects.flatMap((effect) =>
    LandingEffect.$match(effect, {
      Emit: (): readonly NextStep[] => [],
      Land: ({ main, tree }) => [NextStep.cases.Land.make({ main, tree })],
      Merge: ({ base, fork, head, main }) => [
        NextStep.cases.Merge.make({ base, fork, head, main }),
      ],
      Record: () => [],
      Retry: ({ at }) => [NextStep.cases.Retry.make({ at })],
      RunChecks: ({ tree }) => [NextStep.cases.RunChecks.make({ tree })],
    })
  );

/** What a call is about, to tell whether the run still waits on it. */
const keyOf = (call: NextStep): string =>
  NextStep.match(call, {
    Land: ({ main, tree }) => `land ${main} ${tree}`,
    Merge: ({ head, main }) => `merge ${head} onto ${main}`,
    Retry: () => "retry",
    RunChecks: ({ tree }) => `checks ${tree}`,
  });

/** Whether the answer's run waits on `call` now. */
const waitsOn = (run: AnswerRun, call: NextStep) =>
  callsOf(nextSteps(run)).some((each) => keyOf(each) === keyOf(call));

/** The answer's project, as the platform reaches it. */
const projectOf = (project: ProjectName) =>
  Projects.use((projects) => projects.get(project)).pipe(Effect.orDie);

/** The answer's run as its project holds it now. */
const load = ({ project, requestId }: AnswerParams) =>
  Effect.flatMap(projectOf(project), (api) => api.answer(requestId));

/**
 * The port call `effect` names, run as W2's in-process run runs it
 * (`runStep`), on the answer's run as its project holds it now; `None`
 * when the run no longer waits on `call`.
 */
const portCall = (
  params: AnswerParams,
  call: Call<"Land" | "Merge">,
  effect: LandingEffect
) =>
  Effect.flatMap(load(params), (run) =>
    Option.isSome(run) && waitsOn(run.value, call)
      ? runStep(run.value, effect)
      : Effect.succeedNone
  );

/** The answer's head merged onto the main the call names. */
const merge = (params: AnswerParams, call: Call<"Merge">) =>
  portCall(
    params,
    call,
    LandingEffect.Merge({
      base: call.base,
      fork: call.fork,
      head: call.head,
      main: call.main,
    })
  );

/**
 * The checked tree landed on main as the platform's commit, through the
 * project's landing slot (the run waits on a land only while it holds the
 * slot). A main that moved sends the answer back to merge; a busy repo
 * fails the step, for its retries.
 */
const land = (params: AnswerParams, call: Call<"Land">) =>
  Effect.flatMap(
    portCall(
      params,
      call,
      LandingEffect.Land({ main: call.main, tree: call.tree })
    ),
    (given) =>
      Option.isSome(given) && LandingCommand.$is("Busy")(given.value.command)
        ? Effect.fail(new LandBusy({ attempt: given.value.command.attempt }))
        : Effect.succeed(given)
  );

/**
 * One stage's lanes on the merged tree, then each failing lane on main, one
 * step per (main, lane), and the gate's classification of each failure.
 */
const stage = (
  params: AnswerParams,
  tree: Call<"RunChecks">["tree"],
  name: Stage,
  attempt: number
) =>
  Effect.gen(function* () {
    const { step } = yield* StepRunner;

    const ran = yield* step(
      `${name}#${attempt}`,
      StageRun,
      Effect.flatMap(load(params), (run) =>
        Option.match(run, {
          onNone: () => Effect.succeed(StageRun.cases.Moved.make({})),
          onSome: (found) => runStage(found, tree, name),
        })
      )
    );

    if (!StageRun.guards.Ran(ran)) {
      return { ran, refusals: [] };
    }

    const onMain = yield* Effect.forEach(toCompareOnMain(ran), (lane) =>
      Effect.map(
        step(
          `main:${ran.checked.main}:${lane.lane}`,
          LaneOutcome,
          laneOnMain(ran.checked, lane)
        ),
        (outcome) => [lane.lane, outcome] as const
      )
    );

    return {
      ran,
      refusals: refusalsOf(ran, new Map<LaneName, LaneOutcome>(onMain)),
    };
  });

/**
 * The checks on the exact merged tree: the cheap stage, then, if it passed,
 * the ask's own check and every other project lane. The first stage that
 * refuses ends them, with its refusals and its lanes.
 */
const checks = (
  params: AnswerParams,
  call: Call<"RunChecks">,
  attempt: number
): Effect.Effect<Option.Option<Reported>, never, AnswerPorts> =>
  Effect.gen(function* () {
    const cheap = yield* stage(params, call.tree, "cheap", attempt);

    // W4 417: the cheap stage's ratchet counts, and the decisions a reasoned
    // escape asks for, join here.
    const judged =
      StageRun.guards.Ran(cheap.ran) && cheap.refusals.length === 0
        ? yield* stage(params, call.tree, "checks", attempt)
        : undefined;

    const last = judged ?? cheap;

    return StageRun.match(last.ran, {
      Blocked: ({ attempt: at }) =>
        reported(LandingCommand.Blocked({ attempt: at })),
      Moved: () => Option.none(),
      Ran: ({ checked, heldBack, lanes }) =>
        reported(
          LandingCommand.Checked({
            decisions: [],
            finish: checked.finish,
            refusals: last.refusals,
            tree: call.tree,
          }),
          {
            heldBack,
            lanes: [
              ...(judged !== undefined && StageRun.guards.Ran(cheap.ran)
                ? cheap.ran.lanes
                : []),
              ...lanes,
            ].map(({ result }) => result),
          }
        ),
    });
  });

/**
 * A port step's report given to the project, and the calls to run next.
 * When nothing comes next, or the step had nothing to report, the run's own
 * state says what it waits on: a person, the landing slot, a retry, or
 * nothing (the report was given already, by a step whose effect ran twice).
 */
const record = (params: AnswerParams, given: Option.Option<Reported>) =>
  Effect.gen(function* () {
    const api = yield* projectOf(params.project);

    if (Option.isSome(given)) {
      const advanced = yield* api.advanceAnswer(
        params.requestId,
        given.value.command,
        given.value.report
      );

      const calls = callsOf(advanced.effects);

      if (Array.isReadonlyArrayNonEmpty(calls)) {
        return { effects: calls, outcome: advanced.outcome } satisfies Steps;
      }
    }

    const run = yield* api.answer(params.requestId);

    if (Option.isNone(run)) {
      return yield* Effect.die(new UnknownRequest(params));
    }

    return {
      effects: callsOf(nextSteps(run.value)),
      outcome: outcomeOf(run.value.state),
    } satisfies Steps;
  });

/**
 * What writing an answer's verdict note came to, kept as the step's value:
 * a replay reads it back, and a note that could not be written never fails
 * the run, in this run or a replay (W3 313 #5).
 */
const Noted = Schema.TaggedUnion({
  /** The answer has no verdict to note: no tree of it was checked. */
  Unjudged: {},
  /** The note could not be written, for this reason; the verdict stands in the project. */
  Unwritten: { reason: Schema.String },
  Written: { changed: Schema.Boolean, notesTip: CommitSha },
});

/** How often a busy fork is asked again for the note before it is given up. */
const noteRetry = {
  schedule: Schedule.exponential("250 millis"),
  times: 2,
  while: Schema.is(HostBusy),
};

/** The verdict as `verdict` shows it: the one the checks gave, with where the answer stands now. */
const shownVerdict = (run: AnswerRun) =>
  Option.map(Option.fromUndefinedOr(run.verdict), (made): Verdict => ({
    ...made,
    outcome: outcomeOf(run.state),
  }));

/** The answer's verdict, as it stands, written as the note on its head in its fork. */
const noteVerdict = (params: AnswerParams) =>
  Effect.gen(function* () {
    const run = yield* load(params);

    const judged = Option.flatMap(run, (found) =>
      Option.map(shownVerdict(found), (verdict) => ({
        fork: found.state.request.fork,
        verdict,
      }))
    );

    if (Option.isNone(judged)) {
      return Noted.cases.Unjudged.make({});
    }

    const { fork, verdict } = judged.value;

    const written = yield* writeVerdictNote({
      fork,
      head: verdict.head,
      verdict,
    }).pipe(Effect.retry(noteRetry));

    return Noted.cases.Written.make(written);
  }).pipe(
    // Anything but an interruption is recorded: the note is bookkeeping, and
    // a fork its answerer filled with refs of their own may break it.
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.as(
            Effect.logWarning(
              "an answer's verdict note was not written",
              cause
            ),
            Noted.cases.Unwritten.make({
              reason: Option.match(Cause.findErrorOption(cause), {
                onNone: () => "defect",
                onSome: ({ _tag }) => _tag,
              }),
            })
          )
    )
  );

/**
 * Once the run stops, the verdict note on the answer's head in its fork
 * (spec D22, W4 407): the verdict as `verdict` shows it, so an answerer
 * reads where the answer stands with plain git, refused, waiting or
 * landed. Its own step, named for the outcome the run stopped at, so a
 * replay reads the record and a restarted run writes the same note again,
 * which changes nothing. The canonical note is `Lander.land`'s.
 */
const notes = (
  params: AnswerParams,
  outcome: Outcome
): Effect.Effect<void, never, AnswerPorts> =>
  Effect.flatMap(StepRunner, ({ step }) =>
    Effect.asVoid(step(`notes:${outcome._tag}`, Noted, noteVerdict(params)))
  );

/** The port call a step runs, under its name. */
const portStep = (
  params: AnswerParams,
  call: Call<"Land" | "Merge" | "RunChecks">,
  attempt: number
): Effect.Effect<Option.Option<Reported>, never, AnswerPorts> =>
  Effect.flatMap(StepRunner, ({ step }) =>
    Match.valueTags(call, {
      Land: (landing) =>
        step(
          `land#${attempt}`,
          Reporting,
          land(params, landing),
          landRetry
        ).pipe(
          Effect.catchTag("LandBusy", ({ attempt: at }) =>
            Effect.succeed(reported(LandingCommand.Busy({ attempt: at })))
          )
        ),
      Merge: (merging) =>
        step(`merge#${attempt}`, Reporting, merge(params, merging)),
      RunChecks: (checking) => checks(params, checking, attempt),
    })
  );

const nameOf = {
  Land: "land",
  Merge: "merge",
  RunChecks: "checks",
} as const satisfies Record<keyof Attempts, string>;

/** Runs the calls `at` names, one after another, until none is left. */
const carry = (
  params: AnswerParams,
  at: Steps,
  attempts: Attempts
): Effect.Effect<Outcome, never, AnswerPorts> =>
  Effect.gen(function* () {
    // A retry is the project's to start, at its alarm.
    if (at.effects.some(NextStep.guards.Retry)) {
      return at.outcome;
    }

    const call = at.effects.find(
      (each): each is Call<"Land" | "Merge" | "RunChecks"> =>
        !NextStep.guards.Retry(each)
    );

    if (call === undefined) {
      return at.outcome;
    }

    const attempt = attempts[call._tag] + 1;
    const given = yield* portStep(params, call, attempt);
    const { step } = yield* StepRunner;

    const next = yield* step(
      `record:${nameOf[call._tag]}#${attempt}`,
      Steps,
      record(params, given)
    );

    if (Option.isNone(given)) {
      return next.outcome;
    }

    return yield* carry(params, next, { ...attempts, [call._tag]: attempt });
  });

/**
 * Carries one admitted answer as far as it goes now: merged onto main,
 * checked on the merged tree, and landed through its project's serial
 * queue, or refused, or waiting. The same request run again converges on
 * one outcome and one landing (principle 8).
 */
export const runAnswer = (
  params: AnswerParams
): Effect.Effect<Outcome, never, AnswerPorts> =>
  Effect.gen(function* () {
    const { step } = yield* StepRunner;
    const run = yield* step("load", Schema.Option(AnswerRun), load(params));

    if (Option.isNone(run)) {
      return yield* Effect.die(new UnknownRequest(params));
    }

    const outcome = yield* carry(
      params,
      {
        effects: callsOf(nextSteps(run.value)),
        outcome: outcomeOf(run.value.state),
      },
      { Land: 0, Merge: 0, RunChecks: 0 }
    );

    yield* notes(params, outcome);

    return outcome;
  });
