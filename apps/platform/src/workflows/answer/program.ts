/**
 * The Answer Workflow's program: one admitted answer
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
 * answer no longer waits on that call), as the in-process run (`/inline`) does:
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
import { LaneOutcome, Verdict } from "@repo/protocol/domain/answer";
import type { Outcome } from "@repo/protocol/domain/outcome";
import { CommitSha } from "@repo/protocol/ids";
import type {
  EnvKey,
  LaneName,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import {
  Array,
  Cause,
  Data,
  Effect,
  Match,
  Option,
  Schedule,
  Schema,
  Struct,
} from "effect";

import type { AnswerParams } from "../../answer-runs.ts";
import { writeVerdictNote } from "../notes.ts";
import { StepRunner } from "../step.ts";
import type { StepRetry } from "../step.ts";
import { guards, GuardRun, passes } from "./guards.ts";
import { heldBack, HeldBackRun, unsealed } from "./held-back.ts";
import type { Judged } from "./held-back.ts";
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
 * The port call `effect` names, run as the in-process run runs it
 * (`runStep`), on the answer's run as its project holds it now (as
 * `prepare` hands it on); `None` when the run no longer waits on `call`.
 */
const portCall = (
  params: AnswerParams,
  call: Call<"Land" | "Merge">,
  effect: LandingEffect,
  prepare: (run: AnswerRun) => Effect.Effect<AnswerRun, never, Projects> = (
    run
  ) => Effect.succeed(run)
) =>
  Effect.flatMap(load(params), (run) =>
    Option.isSome(run) && waitsOn(run.value, call)
      ? Effect.flatMap(prepare(run.value), (ready) => runStep(ready, effect))
      : Effect.succeedNone
  );

/** A verdict as its note holds it: JSON. */
const encodeVerdict = Schema.encodeEffect(Schema.fromJsonString(Verdict));

/**
 * The stored write-only value `verdict`'s note would carry, by its item:
 * the project scans the note before it leaves the run. Only the
 * platform's log hears which item, never the value.
 */
const leakIn = (params: AnswerParams, verdict: Verdict, where: string) =>
  Effect.gen(function* () {
    const text = yield* Effect.orDie(encodeVerdict(verdict));
    const api = yield* projectOf(params.project);
    const found = yield* api.scanForValues({ text });

    if (Option.isSome(found)) {
      yield* Effect.logWarning(
        "an answer's verdict note held a stored write-only value; it was not written"
      ).pipe(
        Effect.annotateLogs({
          item: found.value,
          project: params.project,
          requestId: params.requestId,
          where,
        })
      );
    }

    return found;
  });

/**
 * The run as its land takes it: the verdict `Lander.land` writes as the
 * landed commit's note on canonical is left off when it holds a stored
 * value, so the landing writes no note; the verdict stands in the project.
 */
const withSafeNote = (params: AnswerParams) => (run: AnswerRun) =>
  run.verdict === undefined
    ? Effect.succeed(run)
    : Effect.map(leakIn(params, run.verdict, "canonical"), (leaked) =>
        Option.isSome(leaked) ? Struct.omit(run, ["verdict"]) : run
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
      LandingEffect.Land({ main: call.main, tree: call.tree }),
      withSafeNote(params)
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
 * The refusals of the cheap stage's counts: a ratchet whose command printed
 * no count the platform can read is the gate's trouble, never the answer's
 * (`VerifierBlocked`), and the project hears which one in its log.
 */
const uncountedRefusals = (cheap: StageRun) =>
  StageRun.guards.Ran(cheap) && cheap.uncounted !== undefined
    ? Effect.as(
        Effect.logWarning(
          `the ratchet ${cheap.uncounted} printed no count on ${cheap.checked.tree}`
        ),
        [new VerifierBlocked({})]
      )
    : Effect.succeed([]);

/** What a port step came to: its report, and the held-back run it judged, if any. */
interface Ran {
  readonly given: Option.Option<Reported>;
  readonly judged: Option.Option<Judged>;
}

const ranOnly = (given: Option.Option<Reported>): Ran => ({
  given,
  judged: Option.none(),
});

/**
 * An answer that adds a file holding a stored write-only value, until its
 * deciders can be asked: the run refuses it as the platform's trouble
 * (`VerifierBlocked`, which names nothing, so the scan is no oracle on
 * which item a guess matched), and only the platform's log says which
 * items, never a value. The `SecretInTree` decision on the deciders' Today
 * that should hold it instead (`AwaitingDecision` for its answerer) is the
 * project service's to open.
 */
const quarantine = (
  params: AnswerParams,
  items: readonly EnvKey[]
): Effect.Effect<readonly VerifierBlocked[]> =>
  Array.isReadonlyArrayEmpty(items)
    ? Effect.succeed([])
    : Effect.as(
        Effect.logWarning(
          "an answer adds a file holding a stored write-only value"
        ).pipe(
          Effect.annotateLogs({
            items: items.join(","),
            project: params.project,
            requestId: params.requestId,
          })
        ),
        [new VerifierBlocked({})]
      );

/** The checks reported refused before any lane ran: the landing guards' refusals. */
const guardedOut = (
  params: AnswerParams,
  call: Call<"RunChecks">,
  run: Extract<GuardRun, { readonly _tag: "Guarded" }>
) =>
  Effect.map(quarantine(params, run.quarantined), (quarantined): Ran =>
    ranOnly(
      reported(
        LandingCommand.Checked({
          decisions: [],
          finish: run.finish,
          refusals: [...run.refusals, ...quarantined],
          tree: call.tree,
        }),
        { heldBack: [], lanes: [] }
      )
    )
  );

/**
 * The checks on the exact merged tree: first the landing guards (when the
 * visibility cartridge provides them, `guards.ts`), then the cheap stage
 * (its lanes, and the ratchets' counts), then, if it passed, the ask's own
 * check and every other project lane, then, if those passed and a
 * held-back suite judges the answer, its held-back run (step 7 (d),
 * `held-back.ts`; `earlier` carries over to an unchanged patch). The first
 * stage that refuses ends them, with its refusals and its lanes. The counts
 * go to the project with the report, which judges them against its
 * baselines and opens the decisions a reasoned escape
 * asks for (step 7 (e)).
 */
const checks = (
  params: AnswerParams,
  call: Call<"RunChecks">,
  attempt: number,
  earlier: Option.Option<Judged>
): Effect.Effect<Ran, never, AnswerPorts> =>
  Effect.gen(function* () {
    const guarded = yield* guards(params, call.tree, attempt);

    if (Option.isSome(guarded) && !passes(guarded.value)) {
      return yield* GuardRun.match(guarded.value, {
        Blocked: ({ attempt: at }) =>
          Effect.succeed(
            ranOnly(reported(LandingCommand.Blocked({ attempt: at })))
          ),
        Guarded: (run) => guardedOut(params, call, run),
        Moved: () => Effect.succeed(ranOnly(Option.none())),
      });
    }

    const ran = yield* stage(params, call.tree, "cheap", attempt);

    const cheap = {
      ...ran,
      refusals: [...ran.refusals, ...(yield* uncountedRefusals(ran.ran))],
    };

    const judged =
      StageRun.guards.Ran(cheap.ran) && cheap.refusals.length === 0
        ? yield* stage(params, call.tree, "checks", attempt)
        : undefined;

    const last = judged ?? cheap;

    const sealed =
      judged !== undefined &&
      StageRun.guards.Ran(judged.ran) &&
      judged.refusals.length === 0 &&
      judged.ran.checked.sealed === true
        ? yield* heldBack(params, call.tree, attempt, earlier)
        : unsealed;

    const counts = StageRun.guards.Ran(cheap.ran)
      ? Option.fromUndefinedOr(cheap.ran.counts)
      : Option.none();

    if (HeldBackRun.guards.Blocked(sealed)) {
      return ranOnly(
        reported(LandingCommand.Blocked({ attempt: sealed.attempt }))
      );
    }

    const held = HeldBackRun.guards.Judged(sealed)
      ? Option.some(sealed)
      : Option.none();

    const given = StageRun.match(last.ran, {
      Blocked: ({ attempt: at }) =>
        reported(LandingCommand.Blocked({ attempt: at })),
      Moved: () => Option.none(),
      Ran: ({ checked, lanes }) =>
        reported(
          LandingCommand.Checked({
            decisions: [],
            finish: checked.finish,
            refusals: [
              ...last.refusals,
              ...Option.match(held, {
                onNone: () => [],
                onSome: ({ refusals }) => refusals,
              }),
            ],
            tree: call.tree,
          }),
          {
            heldBack: Option.match(held, {
              onNone: () => [],
              onSome: ({ results }) => results,
            }),
            lanes: [
              ...(judged !== undefined && StageRun.guards.Ran(cheap.ran)
                ? cheap.ran.lanes
                : []),
              ...lanes,
            ].map(({ result }) => result),
            ...Option.match(counts, {
              onNone: () => ({}),
              onSome: (ratchets) => ({ ratchets }),
            }),
          }
        ),
    });

    return { given, judged: held };
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
 * the run, in this run or a replay.
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

    // The note leaves the run for the answer's fork: a note that holds a
    // stored value is not written; the verdict stands in the project.
    if (Option.isSome(yield* leakIn(params, verdict, "fork"))) {
      return Noted.cases.Unwritten.make({ reason: "SecretInOutput" });
    }

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
 * Once the run stops, the verdict note on the answer's head in its fork:
 * the verdict as `verdict` shows it, so an answerer
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
  attempt: number,
  earlier: Option.Option<Judged>
): Effect.Effect<Ran, never, AnswerPorts> =>
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
          ),
          Effect.map(ranOnly)
        ),
      Merge: (merging) =>
        Effect.map(
          step(`merge#${attempt}`, Reporting, merge(params, merging)),
          ranOnly
        ),
      RunChecks: (checking) => checks(params, checking, attempt, earlier),
    })
  );

const nameOf = {
  Land: "land",
  Merge: "merge",
  RunChecks: "checks",
} as const satisfies Record<keyof Attempts, string>;

/**
 * Runs the calls `at` names, one after another, until none is left.
 * `earlier` is the last held-back run of this Workflow, which carries over
 * to a later check of an unchanged patch.
 */
const carry = (
  params: AnswerParams,
  at: Steps,
  attempts: Attempts,
  earlier: Option.Option<Judged>
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
    const { given, judged } = yield* portStep(params, call, attempt, earlier);
    const { step } = yield* StepRunner;

    const next = yield* step(
      `record:${nameOf[call._tag]}#${attempt}`,
      Steps,
      record(params, given)
    );

    if (Option.isNone(given)) {
      return next.outcome;
    }

    return yield* carry(
      params,
      next,
      { ...attempts, [call._tag]: attempt },
      Option.orElse(judged, () => earlier)
    );
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
      { Land: 0, Merge: 0, RunChecks: 0 },
      Option.none()
    );

    yield* notes(params, outcome);

    return outcome;
  });
