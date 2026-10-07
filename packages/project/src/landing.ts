/**
 * The landing lifecycle: one answer request's way from the queue to main
 * (ADR 0012). A pure `transition(state, command, now)` returns the next state
 * and the effects the project service settles; it reads no clock and calls no
 * port. A command that does not apply to a state changes nothing, so a replay
 * converges (principle 8).
 */
import { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import type { CreditRole } from "@repo/protocol/domain/credit";
import type { Choice } from "@repo/protocol/domain/decision";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { ProjectEvent } from "@repo/protocol/domain/event";
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
import { Array, Data, DateTime, Duration, Match, Option, Schema } from "effect";

/** How many times a moved main may send an answer back to merge before it is refused as stale. */
export const maxRemerges = 3;

/**
 * One path an answer's merge changed. Structurally the gate's and git's
 * `Change`, so the service passes one where the other is expected.
 */
export const Change = Schema.Struct({
  after: Schema.optionalKey(BlobSha),
  before: Schema.optionalKey(BlobSha),
  path: RepoPath,
  status: Schema.Literals(["added", "modified", "deleted"]),
});

export type Change = typeof Change.Type;

/**
 * An admitted answer, as the gate let it through: who answers which ask from
 * which fork, and the credit its landing will carry.
 */
export const Request = Schema.Struct({
  answerer: Handle,
  /** Absent for a decider's own landing. */
  ask: Schema.OptionFromOptionalKey(AskId),
  assisted: Schema.Array(AgentTrailer),
  base: CommitSha,
  /**
   * The credit trailers the landing carries; a finish adds `Finished-by`, and
   * an accepted decision `Decided-by`.
   */
  credits: Schema.Array(Credit),
  fork: RepoName,
  head: CommitSha,
  project: ProjectName,
  requestId: RequestId,
});

export type Request = typeof Request.Type;

/**
 * A decision an answer can wait on. Declining one refuses the answer with the
 * refusal it stands for.
 */
export const AnswerDecision = Schema.Union([
  DecisionSubject.cases.PostureChange,
  DecisionSubject.cases.RaiseRatchet,
  DecisionSubject.cases.Waiver,
]).pipe(Schema.toTaggedUnion("_tag"));

export type AnswerDecision = typeof AnswerDecision.Type;

/** A decision the answer waits on, with the id the service minted for it. */
export const PendingDecision = Schema.Struct({
  id: DecisionId,
  subject: AnswerDecision,
});

export type PendingDecision = typeof PendingDecision.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

// What every state between the queue and main carries: the main it works
// against, how often a moved main sent it back, and how often a port retried.
const underway = {
  attempt: Count,
  main: LandedSha,
  remerges: Count,
  request: Request,
};

const checkedFields = { ...underway, tree: TreeSha };

/** Where one answer request stands on its way to main. */
export const LandingState = Schema.TaggedUnion({
  /** Passed its checks, and waits on decisions; a finish may follow. */
  AwaitingDecision: {
    ...checkedFields,
    decisions: Schema.NonEmptyArray(PendingDecision),
    finish: AskKind.fields.finish,
  },
  /** Passed its checks, and waits for a decider's finish. */
  AwaitingFinish: checkedFields,
  /** The merged tree is being checked. */
  Checking: { ...checkedFields, changes: Schema.Array(Change) },
  Landed: { request: Request, sha: LandedSha },
  /** Passed every stage; the platform is landing the tree on main. */
  Landing: checkedFields,
  /** Being merged onto `main`. */
  Merging: underway,
  Queued: { request: Request },
  Refused: { refusals: Schema.NonEmptyArray(Refusal), request: Request },
  /** Passed the gate, and waits for its parent ask to land first. */
  WaitingOnParent: { parent: AskId, request: Request },
});

export type LandingState = typeof LandingState.Type;

/** What the service tells a landing: a port's answer, a person's decision, or the queue's go. */
export type LandingCommand = Data.TaggedEnum<{
  /** The queue started the request against the landed main. */
  Start: { readonly main: LandedSha };
  /** The request's ask waits on its parent; `Start` resumes it. */
  Wait: { readonly parent: AskId };
  /** The merge onto `main` came out clean. */
  Merged: {
    readonly changes: readonly Change[];
    readonly main: LandedSha;
    readonly tree: TreeSha;
  };
  /** The merge onto `main` conflicted in these paths. */
  MergeConflict: {
    readonly conflicts: readonly RepoPath[];
    readonly main: LandedSha;
  };
  /** The checks judged `tree`. */
  Checked: {
    readonly decisions: readonly PendingDecision[];
    readonly finish: AskKind["finish"];
    readonly refusals: readonly Refusal[];
    readonly tree: TreeSha;
  };
  /** A decider finished the answer. */
  Finished: { readonly by: Handle };
  /** Decider `by` decided one of the decisions the answer waits on. */
  Decided: {
    readonly by: Handle;
    readonly choice: Choice;
    readonly decision: DecisionId;
  };
  /** Landing found main moved from `from`, the main it landed against, to `main`. */
  MainMoved: { readonly from: LandedSha; readonly main: LandedSha };
  /** The landing is on main at `sha`. */
  LandedOk: { readonly sha: LandedSha };
  /** The repo was busy with another push during landing attempt `attempt`. */
  Busy: { readonly attempt: number };
  /**
   * A port answered `VerifierBlocked` during attempt `attempt`: retried with
   * backoff, never counted against the answerer.
   */
  Blocked: { readonly attempt: number };
}>;

export const LandingCommand = Data.taggedEnum<LandingCommand>();

type WithoutSeq<E> = E extends ProjectEvent ? Omit<E, "seq"> : never;

/** A project event before the store gives it its place in the sequence. */
export type ProjectEventInput = WithoutSeq<ProjectEvent>;

export const ProjectEventInput = Data.taggedEnum<ProjectEventInput>();

/** What the service runs for a landing: the transition only describes it. */
export type LandingEffect = Data.TaggedEnum<{
  Merge: {
    readonly base: CommitSha;
    readonly fork: RepoName;
    readonly head: CommitSha;
    readonly main: LandedSha;
  };
  RunChecks: { readonly tree: TreeSha };
  Land: { readonly main: LandedSha; readonly tree: TreeSha };
  /** Run the state's `pendingEffects` again at `at`. */
  Retry: { readonly at: DateTime.Utc };
  Emit: { readonly event: ProjectEventInput };
  /** Record the landing: close the ask, answer the claim, move the landed SHA. */
  Record: { readonly sha: LandedSha };
}>;

export const LandingEffect = Data.taggedEnum<LandingEffect>();

/** One step of a landing: the state it reached and the effects to settle. */
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

/** How long a retry waits after attempt `attempt`: a second, doubling, up to five minutes. */
export const backoff = (attempt: number): Duration.Duration =>
  Duration.millis(Math.min(1000 * 2 ** attempt, 5 * 60 * 1000));

/**
 * The port call a state waits on: the service runs it when the state is
 * entered, and again at a `Retry`.
 */
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

// A port answered `Busy` or `VerifierBlocked` for this attempt: the same
// state waits, then runs its port call again. A report for another attempt
// is a replay, and changes nothing.
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

// The landing credits a person once in each role, however often they act in it.
const credit = (request: Request, role: CreditRole, handle: Handle): Request =>
  request.credits.some(
    (given) => given.role === role && given.handle === handle
  )
    ? request
    : { ...request, credits: [...request.credits, { handle, role }] };

// Every stage passed but the human one: wait on each decision first, then on
// a finish the kind requires and nobody gave yet, then land.
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

/** The refusal a declined decision stands for. */
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

// Main moved under the landing. A report about another main is a replay. A
// clean re-merge goes back through the checks; past the limit it is stale.
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

/**
 * One step of a landing. A command that does not apply to the state, or
 * reports on another main, tree, attempt or decision than the state is at,
 * returns the state as it was with no effects: replays and late duplicates
 * converge. Landed and Refused never move.
 */
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
        Match.tag("MergeConflict", ({ conflicts, main }) =>
          main === merging.main
            ? refuse(merging.request, [
                new StaleBase({ base: merging.request.base, conflicts, main }),
              ])
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

/** Where the answer stands, as `status`, `verdict` and MCP report it. */
export const outcomeOf = (state: LandingState): Outcome =>
  LandingState.match<Outcome>(state, {
    AwaitingDecision: ({ decisions }) =>
      Outcome.cases.AwaitingDecision.make({ decision: decisions[0].id }),
    AwaitingFinish: () => Outcome.cases.AwaitingFinish.make({}),
    Checking: () => Outcome.cases.Checking.make({ stage: "checks" }),
    Landed: ({ sha }) => Outcome.cases.Landed.make({ sha }),
    // Past every stage: the landing closes the last one.
    Landing: () => Outcome.cases.Checking.make({ stage: "human" }),
    Merging: () => Outcome.cases.Checking.make({ stage: "merge" }),
    Queued: () => Outcome.cases.Checking.make({ stage: "merge" }),
    Refused: ({ refusals }) => Outcome.cases.Refused.make({ refusals }),
    WaitingOnParent: ({ parent }) =>
      Outcome.cases.WaitingOnParent.make({ ask: parent }),
  });

/**
 * The project's landing queue, as a value the store persists: requests land
 * one at a time, in the order their checks passed.
 */
export const LandingQueue = Schema.Struct({
  /** The request whose landing is underway. */
  active: Schema.OptionFromOptionalKey(RequestId),
  order: Schema.Array(RequestId),
});

export type LandingQueue = typeof LandingQueue.Type;

const isActive = (queue: LandingQueue, id: RequestId) =>
  Option.contains(queue.active, id);

/** Adds a request to the back of the queue; a request already in it stays where it is. */
export const enqueue = (queue: LandingQueue, id: RequestId): LandingQueue =>
  isActive(queue, id) || queue.order.includes(id)
    ? queue
    : { ...queue, order: [...queue.order, id] };

/** Admits the request at the front, unless one is already landing. */
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

/**
 * Frees the slot once a request's landing is over (landed, refused or sent
 * back to merge), or drops a request that leaves before its turn.
 */
export const settle = (queue: LandingQueue, id: RequestId): LandingQueue =>
  isActive(queue, id)
    ? { ...queue, active: Option.none() }
    : { ...queue, order: queue.order.filter((waiting) => waiting !== id) };
