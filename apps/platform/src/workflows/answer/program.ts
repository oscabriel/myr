// Step names carry their attempt (`merge#2`), so a merge onto a main that moved is a
// new step, not a replay. The run stops when a port step finds nothing to do, or it
// could ask for the same call forever.
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
import type { Outcome, StageName } from "@repo/protocol/domain/outcome";
import { CommitSha } from "@repo/protocol/ids";
import type {
  EnvKey,
  LaneName,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
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

export type AnswerPorts =
  | CheckRunner
  | EvidenceStore
  | Lander
  | Projects
  | RepoHost
  | StepRunner;

export class UnknownRequest extends Data.TaggedError("UnknownRequest")<{
  readonly project: ProjectName;
  readonly requestId: RequestId;
}> {}

class LandBusy extends Data.TaggedError("LandBusy")<{
  readonly attempt: number;
}> {}

export const landRetry: StepRetry = {
  backoff: "exponential",
  delayMs: 1000,
  limit: 3,
};

export const Reported = Schema.Struct({
  command: ReportedCommand,
  report: Schema.optionalKey(AnswerReport),
});

export type Reported = typeof Reported.Type;

const Reporting = Schema.Option(Reported);

type NextStep = typeof NextStep.Type;

type Steps = typeof Steps.Type;

type Call<Tag extends NextStep["_tag"]> = Extract<
  NextStep,
  { readonly _tag: Tag }
>;

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

const keyOf = (call: NextStep): string =>
  NextStep.match(call, {
    Land: ({ main, tree }) => `land ${main} ${tree}`,
    Merge: ({ head, main }) => `merge ${head} onto ${main}`,
    Retry: () => "retry",
    RunChecks: ({ tree }) => `checks ${tree}`,
  });

const waitsOn = (run: AnswerRun, call: NextStep) =>
  callsOf(nextSteps(run)).some((each) => keyOf(each) === keyOf(call));

const projectOf = (project: ProjectName) =>
  Projects.use((projects) => projects.get(project)).pipe(Effect.orDie);

const load = ({ project, requestId }: AnswerParams) =>
  Effect.flatMap(projectOf(project), (api) => api.answer(requestId));

const portCall = (
  params: AnswerParams,
  call: Call<"Land" | "Merge">,
  effect: LandingEffect,
  prepare: (run: AnswerRun) => Effect.Effect<AnswerRun, never, Projects> = (
    run
  ) => Effect.succeed(run)
) =>
  Effect.gen(function* () {
    const api = yield* projectOf(params.project);
    const run = yield* api.answer(params.requestId);

    if (Option.isNone(run) || !waitsOn(run.value, call)) {
      return Option.none();
    }

    const ready = yield* prepare(run.value);

    return yield* runStep(ready, effect, api.landings);
  });

const encodeVerdict = Schema.encodeEffect(Schema.fromJsonString(Verdict));

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

const withSafeNote = (params: AnswerParams) => (run: AnswerRun) =>
  run.verdict === undefined
    ? Effect.succeed(run)
    : Effect.map(leakIn(params, run.verdict, "canonical"), (leaked) =>
        Option.isSome(leaked) ? Struct.omit(run, ["verdict"]) : run
      );

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

const uncountedRefusals = (cheap: StageRun) =>
  StageRun.guards.Ran(cheap) && cheap.uncounted !== undefined
    ? Effect.as(
        Effect.logWarning(
          `the ratchet ${cheap.uncounted} printed no count on ${cheap.checked.tree}`
        ),
        [new VerifierBlocked({})]
      )
    : Effect.succeed([]);

interface Ran {
  readonly given: Option.Option<Reported>;
  readonly judged: Option.Option<Judged>;
}

/** The checks stage runs only when the cheap one refused nothing, and the held-back one only when neither did. */
const refusingStage = (input: {
  readonly checked: boolean;
  readonly held: readonly Refusal[];
  readonly last: readonly Refusal[];
}): Option.Option<StageName> => {
  if (input.held.length > 0) {
    return Option.some("heldBack");
  }

  if (input.last.length > 0) {
    return Option.some(input.checked ? "checks" : "cheap");
  }

  return Option.none();
};

const ranOnly = (given: Option.Option<Reported>): Ran => ({
  given,
  judged: Option.none(),
});

// `VerifierBlocked` names nothing, so the scan is no oracle on which item a guess
// matched; only the platform's log names the items, never a value.
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
        // The landing guards hold the shape of the tree, as stage 1 does a push's.
        { heldBack: [], lanes: [], stage: "shape" }
      )
    )
  );

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

    const refusedAt = refusingStage({
      checked: judged !== undefined,
      held: Option.match(held, {
        onNone: () => [],
        onSome: ({ refusals }) => refusals,
      }),
      last: last.refusals,
    });

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
            ...Option.match(refusedAt, {
              onNone: () => ({}),
              onSome: (refusing) => ({ stage: refusing }),
            }),
          }
        ),
    });

    return { given, judged: held };
  });

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

const Noted = Schema.TaggedUnion({
  Unjudged: {},
  Unwritten: { reason: Schema.String },
  Written: { changed: Schema.Boolean, notesTip: CommitSha },
});

const noteRetry = {
  schedule: Schedule.exponential("250 millis"),
  times: 2,
  while: Schema.is(HostBusy),
};

const shownVerdict = (run: AnswerRun) =>
  Option.map(Option.fromUndefinedOr(run.verdict), (made): Verdict => ({
    ...made,
    outcome: outcomeOf(run.state),
  }));

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

    // A note that holds a stored value is not written; the verdict stands in the project.
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
    // Anything but an interruption is recorded: the note is bookkeeping, and a fork its
    // answerer filled with refs of their own may break it.
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

const notes = (
  params: AnswerParams,
  outcome: Outcome
): Effect.Effect<void, never, AnswerPorts> =>
  Effect.flatMap(StepRunner, ({ step }) =>
    Effect.asVoid(step(`notes:${outcome._tag}`, Noted, noteVerdict(params)))
  );

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

const carry = (
  params: AnswerParams,
  at: Steps,
  attempts: Attempts,
  earlier: Option.Option<Judged>
): Effect.Effect<Outcome, never, AnswerPorts> =>
  Effect.gen(function* () {
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
