import { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import type { CreditRole } from "@repo/protocol/domain/credit";
import type { Choice } from "@repo/protocol/domain/decision";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { AskKind } from "@repo/protocol/domain/kind";
import { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  BlobSha,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import {
  PostureChange,
  Refusal,
  StaleBase,
  Weakened,
} from "@repo/protocol/refusal";
import type { MovedBy } from "@repo/protocol/refusal";
import { Array, Data, DateTime, Duration, Match, Option, Schema } from "effect";

import { ProjectEventInput } from "./events.ts";

export const maxRemerges = 3;

/** Structurally the gate's and git's `Change`, so either passes where the other is expected. */
export const Change = Schema.Struct({
  after: Schema.optionalKey(BlobSha),
  before: Schema.optionalKey(BlobSha),
  path: RepoPath,
  status: Schema.Literals(["added", "modified", "deleted"]),
});

export type Change = typeof Change.Type;

export const Request = Schema.Struct({
  answerer: Handle,
  /** Absent for a maintainer's own landing. */
  ask: Schema.OptionFromOptionalKey(AskId),
  assisted: Schema.Array(AgentTrailer),
  base: CommitSha,
  credits: Schema.Array(Credit),
  fork: RepoName,
  head: CommitSha,
  project: ProjectName,
  requestId: RequestId,
});

export type Request = typeof Request.Type;

export const AnswerDecision = Schema.Union([
  DecisionSubject.cases.PostureChange,
  DecisionSubject.cases.RaiseRatchet,
  DecisionSubject.cases.Waiver,
]).pipe(Schema.toTaggedUnion("_tag"));

export type AnswerDecision = typeof AnswerDecision.Type;

export const PendingDecision = Schema.Struct({
  id: DecisionId,
  subject: AnswerDecision,
});

export type PendingDecision = typeof PendingDecision.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const underway = {
  attempt: Count,
  main: LandedSha,
  remerges: Count,
  request: Request,
};

const checkedFields = { ...underway, tree: TreeSha };

export const LandingState = Schema.TaggedUnion({
  AwaitingDecision: {
    ...checkedFields,
    decisions: Schema.NonEmptyArray(PendingDecision),
    finish: AskKind.fields.finish,
  },
  AwaitingFinish: checkedFields,
  Checking: { ...checkedFields, changes: Schema.Array(Change) },
  Landed: { request: Request, sha: LandedSha },
  Landing: checkedFields,
  Merging: underway,
  Queued: { request: Request },
  Refused: { refusals: Schema.NonEmptyArray(Refusal), request: Request },
  WaitingOnParent: { parent: AskId, request: Request },
});

export type LandingState = typeof LandingState.Type;

export type LandingCommand = Data.TaggedEnum<{
  Start: { readonly main: LandedSha };
  Wait: { readonly parent: AskId };
  Merged: {
    readonly changes: readonly Change[];
    readonly main: LandedSha;
    readonly tree: TreeSha;
  };
  MergeConflict: {
    readonly conflicts: readonly RepoPath[];
    readonly main: LandedSha;
    readonly movedBy?: Array.NonEmptyReadonlyArray<MovedBy>;
  };
  Checked: {
    readonly decisions: readonly PendingDecision[];
    readonly finish: AskKind["finish"];
    readonly refusals: readonly Refusal[];
    readonly tree: TreeSha;
  };
  Finished: { readonly by: Handle };
  Decided: {
    readonly by: Handle;
    readonly choice: Choice;
    readonly decision: DecisionId;
  };
  MainMoved: { readonly from: LandedSha; readonly main: LandedSha };
  LandedOk: { readonly sha: LandedSha };
  Busy: { readonly attempt: number };
  /** Retried with backoff, never counted against the answerer. */
  Blocked: { readonly attempt: number };
}>;

export const LandingCommand = Data.taggedEnum<LandingCommand>();

export type LandingEffect = Data.TaggedEnum<{
  Merge: {
    readonly base: CommitSha;
    readonly fork: RepoName;
    readonly head: CommitSha;
    readonly main: LandedSha;
  };
  RunChecks: { readonly tree: TreeSha };
  Land: { readonly main: LandedSha; readonly tree: TreeSha };
  Retry: { readonly at: DateTime.Utc };
  Emit: { readonly event: ProjectEventInput };
  Record: { readonly sha: LandedSha };
}>;

export const LandingEffect = Data.taggedEnum<LandingEffect>();

export interface Step {
  readonly effects: readonly LandingEffect[];
  readonly state: LandingState;
}

const {
  AwaitingDecision,
  AwaitingFinish,
  Checking,
  Landed,
  Landing,
  Merging,
  Refused,
  WaitingOnParent,
} = LandingState.cases;

type Underway = Pick<
  typeof Merging.Type,
  "attempt" | "main" | "remerges" | "request"
>;

type Passed = Underway & { readonly tree: TreeSha };

const passedOf = ({ attempt, main, remerges, request, tree }: Passed) => ({
  attempt,
  main,
  remerges,
  request,
  tree,
});

export const backoff = (attempt: number): Duration.Duration =>
  Duration.millis(Math.min(1000 * 2 ** attempt, 5 * 60 * 1000));

export const pendingEffects = (state: LandingState): readonly LandingEffect[] =>
  LandingState.matchOrElse<readonly LandingEffect[]>(
    state,
    {
      Checking: ({ tree }) => [LandingEffect.RunChecks({ tree })],
      Landing: ({ main, tree }) => [LandingEffect.Land({ main, tree })],
      Merging: ({ main, request }) => [
        LandingEffect.Merge({
          base: request.base,
          fork: request.fork,
          head: request.head,
          main,
        }),
      ],
    },
    () => []
  );

const stay = (state: LandingState): Step => ({ effects: [], state });

const enter = (state: LandingState): Step => ({
  effects: pendingEffects(state),
  state,
});

const refuse = (
  request: Request,
  refusals: Array.NonEmptyReadonlyArray<Refusal>
): Step => stay(Refused.make({ refusals, request }));

const start = (request: Request, main: LandedSha): Step =>
  enter(Merging.make({ attempt: 0, main, remerges: 0, request }));

const retry = (
  state: typeof Checking.Type | typeof Landing.Type | typeof Merging.Type,
  attempt: number,
  now: DateTime.Utc
): Step =>
  attempt === state.attempt
    ? {
        effects: [
          LandingEffect.Retry({
            at: DateTime.addDuration(now, backoff(attempt)),
          }),
        ],
        state: { ...state, attempt: attempt + 1 },
      }
    : stay(state);

const isFinished = (request: Request) =>
  request.credits.some(({ role }) => role === "Finished-by");

const credit = (request: Request, role: CreditRole, handle: Handle): Request =>
  request.credits.some(
    (given) => given.role === role && given.handle === handle
  )
    ? request
    : { ...request, credits: [...request.credits, { handle, role }] };

const human = (
  passed: Passed,
  decisions: readonly PendingDecision[],
  finish: AskKind["finish"]
): Step =>
  Array.match(decisions, {
    onEmpty: () =>
      finish === "required" && !isFinished(passed.request)
        ? stay(AwaitingFinish.make(passedOf(passed)))
        : enter(Landing.make(passedOf(passed))),
    onNonEmpty: (waiting) =>
      stay(
        AwaitingDecision.make({
          ...passedOf(passed),
          decisions: waiting,
          finish,
        })
      ),
  });

const staleOn = (
  base: CommitSha,
  {
    conflicts,
    main,
    movedBy,
  }: Extract<LandingCommand, { readonly _tag: "MergeConflict" }>
) =>
  movedBy === undefined
    ? new StaleBase({ base, conflicts, main })
    : new StaleBase({ base, conflicts, main, movedBy });

const declined = (subject: AnswerDecision): Refusal =>
  AnswerDecision.match(subject, {
    PostureChange: ({ from, to }) => new PostureChange({ from, to }),
    RaiseRatchet: ({ after, before, ratchet, territory }) =>
      new Weakened({ weakening: { after, before, ratchet, territory } }),
    Waiver: ({ at, marker, reason }) =>
      new Weakened({ at, weakening: { marker, reason } }),
  });

const approves = {
  accept: true,
  adopt: true,
  decline: false,
  revert: false,
} as const satisfies Record<Choice, boolean>;

const decide = (
  state: typeof AwaitingDecision.Type,
  { by, choice, decision }: Data.TaggedEnum.Value<LandingCommand, "Decided">
): Step =>
  Option.match(
    Array.findFirst(state.decisions, ({ id }) => id === decision),
    {
      onNone: () => stay(state),
      onSome: ({ subject }) =>
        approves[choice]
          ? human(
              { ...state, request: credit(state.request, "Decided-by", by) },
              state.decisions.filter(({ id }) => id !== decision),
              state.finish
            )
          : refuse(state.request, [declined(subject)]),
    }
  );

const finished = (state: typeof AwaitingFinish.Type, by: Handle): Step =>
  enter(
    Landing.make({
      ...passedOf(state),
      request: credit(state.request, "Finished-by", by),
    })
  );

const landed = (
  state: typeof Landing.Type,
  sha: LandedSha,
  now: DateTime.Utc
): Step => {
  const { request } = state;

  const view = {
    assisted: request.assisted,
    author: request.answerer,
    credits: request.credits,
    landedAt: now,
    parent: state.main,
    project: request.project,
    requestId: request.requestId,
    sha,
  };

  const landing = LandingView.make(
    Option.match(request.ask, {
      onNone: () => view,
      onSome: (ask) => ({ ...view, ask }),
    })
  );

  return {
    effects: [
      LandingEffect.Emit({
        event: ProjectEventInput.Landed({ at: now, landing }),
      }),
      LandingEffect.Record({ sha }),
    ],
    state: Landed.make({ request, sha }),
  };
};

const moved = (
  state: typeof Landing.Type,
  { from, main }: { readonly from: LandedSha; readonly main: LandedSha }
): Step => {
  if (from !== state.main || main === state.main) {
    return stay(state);
  }

  return state.remerges >= maxRemerges
    ? refuse(state.request, [
        new StaleBase({ base: state.request.base, conflicts: [], main }),
      ])
    : enter(
        Merging.make({
          attempt: state.attempt,
          main,
          remerges: state.remerges + 1,
          request: state.request,
        })
      );
};

/** A command that does not apply, or reports on another main, tree, attempt or decision, changes nothing: replays converge. */
export const transition = (
  state: LandingState,
  command: LandingCommand,
  now: DateTime.Utc
): Step =>
  LandingState.match(state, {
    AwaitingDecision: (waiting) =>
      Match.value(command).pipe(
        Match.tag("Decided", (decided) => decide(waiting, decided)),
        Match.orElse(() => stay(waiting))
      ),
    AwaitingFinish: (waiting) =>
      Match.value(command).pipe(
        Match.tag("Finished", ({ by }) => finished(waiting, by)),
        Match.orElse(() => stay(waiting))
      ),
    Checking: (checking) =>
      Match.value(command).pipe(
        Match.tag("Checked", ({ decisions, finish, refusals, tree }) =>
          tree === checking.tree
            ? Array.match(refusals, {
                onEmpty: () => human(checking, decisions, finish),
                onNonEmpty: (all) => refuse(checking.request, all),
              })
            : stay(checking)
        ),
        Match.tag("Blocked", ({ attempt }) => retry(checking, attempt, now)),
        Match.orElse(() => stay(checking))
      ),
    Landed: stay,
    Landing: (landing) =>
      Match.value(command).pipe(
        Match.tag("LandedOk", ({ sha }) => landed(landing, sha, now)),
        Match.tag("MainMoved", (report) => moved(landing, report)),
        Match.tag("Busy", "Blocked", ({ attempt }) =>
          retry(landing, attempt, now)
        ),
        Match.orElse(() => stay(landing))
      ),
    Merging: (merging) =>
      Match.value(command).pipe(
        Match.tag("Merged", ({ changes, main, tree }) =>
          main === merging.main
            ? enter(
                Checking.make({
                  attempt: merging.attempt,
                  changes,
                  main,
                  remerges: merging.remerges,
                  request: merging.request,
                  tree,
                })
              )
            : stay(merging)
        ),
        Match.tag("MergeConflict", (conflict) =>
          conflict.main === merging.main
            ? refuse(merging.request, [staleOn(merging.request.base, conflict)])
            : stay(merging)
        ),
        Match.tag("Blocked", ({ attempt }) => retry(merging, attempt, now)),
        Match.orElse(() => stay(merging))
      ),
    Queued: (queued) =>
      Match.value(command).pipe(
        Match.tag("Start", ({ main }) => start(queued.request, main)),
        Match.tag("Wait", ({ parent }) =>
          stay(WaitingOnParent.make({ parent, request: queued.request }))
        ),
        Match.orElse(() => stay(queued))
      ),
    Refused: stay,
    WaitingOnParent: (waiting) =>
      Match.value(command).pipe(
        Match.tag("Start", ({ main }) => start(waiting.request, main)),
        Match.orElse(() => stay(waiting))
      ),
  });

export const outcomeOf = (state: LandingState): Outcome =>
  LandingState.match<Outcome>(state, {
    AwaitingDecision: ({ decisions }) =>
      Outcome.cases.AwaitingDecision.make({ decision: decisions[0].id }),
    AwaitingFinish: () => Outcome.cases.AwaitingFinish.make({}),
    Checking: () => Outcome.cases.Checking.make({ stage: "checks" }),
    Landed: ({ sha }) => Outcome.cases.Landed.make({ sha }),
    Landing: () => Outcome.cases.Checking.make({ stage: "human" }),
    Merging: () => Outcome.cases.Checking.make({ stage: "merge" }),
    Queued: () => Outcome.cases.Checking.make({ stage: "merge" }),
    Refused: ({ refusals }) => Outcome.cases.Refused.make({ refusals }),
    WaitingOnParent: ({ parent }) =>
      Outcome.cases.WaitingOnParent.make({ ask: parent }),
  });

export const LandingQueue = Schema.Struct({
  active: Schema.OptionFromOptionalKey(RequestId),
  order: Schema.Array(RequestId),
});

export type LandingQueue = typeof LandingQueue.Type;

const isActive = (queue: LandingQueue, id: RequestId) =>
  Option.contains(queue.active, id);

export const enqueue = (queue: LandingQueue, id: RequestId): LandingQueue =>
  isActive(queue, id) || queue.order.includes(id)
    ? queue
    : { ...queue, order: [...queue.order, id] };

export const next = (
  queue: LandingQueue
): {
  readonly admit: Option.Option<RequestId>;
  readonly queue: LandingQueue;
} =>
  Option.isSome(queue.active)
    ? { admit: Option.none(), queue }
    : Array.match(queue.order, {
        onEmpty: () => ({ admit: Option.none(), queue }),
        onNonEmpty: ([front, ...rest]) => ({
          admit: Option.some(front),
          queue: { active: Option.some(front), order: rest },
        }),
      });

export const settle = (queue: LandingQueue, id: RequestId): LandingQueue =>
  isActive(queue, id)
    ? { ...queue, active: Option.none() }
    : { ...queue, order: queue.order.filter((waiting) => waiting !== id) };
