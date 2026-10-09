/**
 * The decider-facing half of the project service: a decider's Today,
 * proposals and flags, decisions and the defaults their expiry applies,
 * finishes, a decider's own landing from their working fork, vouches and
 * denouncements, and a person's credits. The ledger, the env shape and
 * write-only values are declared here and answered by the visibility ports
 * (`visibility-port.ts`, `env-port.ts`), in `project.ts`.
 *
 * Every call has the core loop's shape (ADR 0012): the project service
 * lends its hydrate, its one-call `write` (hydrate, transition, persist,
 * settle under the project's lock) and the helpers it already has, as a
 * `DeciderKernel`; the attention rules decide, and this module
 * settles what they return. Nothing here reimplements a rule.
 *
 * Two departures, each said where it happens: a decider's `land` runs its
 * landing's steps within the call, as `openAsk` runs red first, since the
 * answer queue keeps a receipt with an ask; and a proposal's files ride on
 * its decision's evidence, since a proposal row holds their paths only.
 */
import { RefName, RepoHost, Revision } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { CheckLane } from "@repo/checks/check-runner";
import type { CheckRunner } from "@repo/checks/check-runner";
import type { PushFacts } from "@repo/gate/facts";
import { pushStages, runGate } from "@repo/gate/gate";
import { scan } from "@repo/gate/stages/shape";
import { formatLanding } from "@repo/git/trailers";
import type { AnswerReceipt, LandReceipt } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { RefNameText } from "@repo/protocol/domain/common";
import type { ConfigFile, Evidence } from "@repo/protocol/domain/common";
import type { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision, Today } from "@repo/protocol/domain/decision";
import type { EnvSchemaView } from "@repo/protocol/domain/env";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { Policy } from "@repo/protocol/domain/policy";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { Proposal } from "@repo/protocol/domain/proposal";
import type { CreditSummary } from "@repo/protocol/domain/record";
import type { RunBlock } from "@repo/protocol/domain/run";
import type { Ledger } from "@repo/protocol/domain/visibility";
import {
  AskId,
  CommitSha,
  DecisionId,
  LandedSha,
  ProposalId,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
  sameHandle,
} from "@repo/protocol/ids";
import type { ProjectName, Handle, EnvKey } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import type { Principal } from "@repo/protocol/principal";
import {
  Denounced,
  NotDecider,
  NotVouched,
  RepoBusy,
  StaleBase,
  TouchedJudge,
  UnknownAsk,
  UnknownProposal,
} from "@repo/protocol/refusal";
import type {
  CapReached,
  DecisionClosed,
  DraftInProgress,
  IncompleteBrief,
  NotRedFirst,
  NotSensitive,
  ProposalClosed,
  Refusal,
  UnknownDecision,
  UnknownEnvItem,
  UnknownProject,
  ValueTooShort,
  VerifierBlocked,
  WeakCheck,
} from "@repo/protocol/refusal";
import { parseVouchFile } from "@repo/rules/vouch";
import {
  Array,
  DateTime,
  Effect,
  Match,
  Option,
  Order,
  Record,
  Schema,
} from "effect";
import type { Redacted } from "effect";

import type { Advanced, AnswerQueue, AnswerRun } from "./answer-runs.ts";
import { isStep, runStep } from "./answer-runs/steps.ts";
import { budgetFor, spend } from "./attention/budget.ts";
import { creditsByArea } from "./attention/credits.ts";
import {
  decide,
  decidersFor,
  expireDecisions,
  openDecision,
} from "./attention/decisions.ts";
import type { Decided } from "./attention/decisions.ts";
import { AttentionEffect, platformHandle } from "./attention/effects.ts";
import {
  draft,
  DraftCommand,
  expire as expireProposals,
  propose,
  ProposalCommand,
} from "./attention/proposals.ts";
import type { Proposed } from "./attention/proposals.ts";
import { recordOf } from "./attention/record.ts";
import { today } from "./attention/today.ts";
import { standing } from "./attention/vouch.ts";
import { ClaimState } from "./claim.ts";
import { DraftResult } from "./draft-runs.ts";
import type { UnlandedRunEnv } from "./env-port.ts";
import { ProjectEventInput } from "./events.ts";
import { pushFacts } from "./facts.ts";
import { Lander, Rebuild } from "./lander.ts";
import type { ComposedFile } from "./lander.ts";
import {
  AnswerDecision,
  LandingCommand,
  LandingState,
  outcomeOf,
  transition,
} from "./landing.ts";
import type { Request, Step } from "./landing.ts";
import { draftRow, OutboxBody, outboxRow, startRow } from "./outbox.ts";
import type {
  AnswerRow,
  BudgetDayRow,
  ClaimRow,
  OutboxRow,
  ProjectRow,
} from "./project-store/rows.ts";

/**
 * The env shape method's name, which is its contract's tag. Lint keeps
 * "shape" out of code names, so the name is spelled once, here, and every
 * table that holds the method keys it by this constant.
 */
export const envSchemaMethod = "envShape";

/** The decider-facing methods of one project's service. */
export interface DeciderApi {
  /**
   * The project's env shape at its landed SHA, as `ProjectEnv` reads it
   * (none without the visibility cartridge). A project with nothing landed
   * has none to read: `UnknownProject`.
   */
  readonly [envSchemaMethod]: (
    caller: Principal
  ) => Effect.Effect<EnvSchemaView, UnknownProject>;
  /** A person's credits in this project, by area and role; never a score. */
  readonly credits: (
    caller: Principal,
    handle: Handle
  ) => Effect.Effect<{ readonly credits: readonly CreditSummary[] }>;
  /**
   * One decider's choice on one decision, spent from their budget; what it
   * says yes to goes ahead in the same call (an accepted proposal opens its
   * ask red first), and a declined proposal closes. An accepted proposal
   * whose ask meets a blocked Checker or a moved main fails with that
   * refusal and decides nothing, so it can be decided again.
   */
  readonly decide: (
    caller: Person,
    input: {
      readonly choice: Choice;
      readonly decision: DecisionId;
      readonly note?: string;
    }
  ) => Effect.Effect<
    { readonly decision: Decision },
    UnknownDecision | DecisionClosed | NotDecider | WaitRefusal
  >;
  /**
   * A decider finishes an answer that waits on a finish: at the answer's
   * own head it lands as it is; at a head with the decider's commits on
   * top, that head is checked again from the merge. Either way the landing
   * carries `Finished-by`, and the finish is spent from their budget.
   */
  readonly finish: (
    caller: Person,
    input: {
      readonly ask: AskId;
      readonly base: CommitSha;
      readonly head: CommitSha;
      readonly requestId: RequestId;
    }
  ) => Effect.Effect<
    AnswerReceipt,
    NotDecider | StaleBase | RepoBusy | TouchedJudge
  >;
  /** A flag on an open ask: a proposal that says it is wrong, for its deciders. */
  readonly flagAsk: (
    caller: Person,
    input: { readonly ask: AskId; readonly reason: string }
  ) => Effect.Effect<
    { readonly proposal: Proposal },
    UnknownAsk | Denounced | CapReached
  >;
  /** The caller's working fork, `<project>--me--<handle>`, made once. */
  readonly fork: (
    caller: Person
  ) => Effect.Effect<
    { readonly fork: RepoName; readonly remote: string },
    NotVouched | Denounced
  >;
  /**
   * A decider's own change, from their working fork, through stages 0–1,
   * the merge and the project's checks, landed as a platform commit they
   * author. Refusals from the stages or the checks come back in the
   * receipt's outcome.
   */
  readonly land: (
    caller: Person,
    input: {
      readonly base: CommitSha;
      readonly head: CommitSha;
      readonly message: string;
      readonly requestId: RequestId;
    }
  ) => Effect.Effect<LandReceipt, NotDecider | StaleBase | RepoBusy>;
  /** The project's public ledger, as `ProjectVisibility` keeps it (Open, empty, without the cartridge). */
  readonly ledger: (caller: Principal) => Effect.Effect<Ledger>;
  /** A proposal for a new ask, and the decision that puts it to its deciders. */
  readonly proposeAsk: (
    caller: Person,
    input: {
      /** Have the platform's agent draft the ask's files. */
      readonly draft?: true;
      readonly files?: Array.NonEmptyReadonlyArray<ComposedFile>;
      readonly sealed?: { readonly head: CommitSha };
      readonly territory?: string;
      readonly want: string;
    }
  ) => Effect.Effect<
    { readonly proposal: Proposal },
    Denounced | CapReached | NotVouched
  >;
  /**
   * A write-only value for a sensitive item, sealed by `ProjectEnv`;
   * without the visibility cartridge no item takes one (`UnknownEnvItem`
   * for a decider, `NotDecider` for anyone else).
   */
  readonly setEnv: (
    caller: Person,
    input: {
      readonly acknowledgeShort?: boolean;
      readonly key: EnvKey;
      readonly value: Redacted.Redacted;
    }
  ) => Effect.Effect<
    {
      readonly key: EnvKey;
      readonly setAt: DateTime.Utc;
      readonly setBy: Handle;
    },
    NotDecider | UnknownEnvItem | NotSensitive | ValueTooShort
  >;
  /**
   * Has the platform's agent draft an open proposal's ask, or draft it
   * again with a note, for its proposer or a decider of its paths; at most
   * `DRAFT_ROUNDS` rounds. The decision a round settles into goes up then.
   */
  readonly draftAsk: (
    caller: Person,
    input: { readonly note?: string; readonly proposal: ProposalId }
  ) => Effect.Effect<
    { readonly proposal: Proposal },
    UnknownProposal | ProposalClosed | NotDecider | DraftInProgress | CapReached
  >;
  /**
   * The public face of a proposal: its state, its draft's, and the files
   * it holds until a decider accepts it.
   */
  readonly showProposal: (
    caller: Principal,
    proposal: ProposalId
  ) => Effect.Effect<
    { readonly files: readonly ConfigFile[]; readonly proposal: Proposal },
    UnknownProposal
  >;
  /** The caller's Today, held to their budget; a person who decides nothing has none. */
  readonly today: (caller: Person) => Effect.Effect<Today, NotDecider>;
  /** A platform landing of the vouch file with the person vouched for, or denounced. */
  readonly vouch: (
    caller: Person,
    input: {
      readonly handle: Handle;
      readonly note?: string;
      readonly verdict: "vouch" | "denounce";
    }
  ) => Effect.Effect<{ readonly landed: LandedSha }, NotDecider | StaleBase>;
}

/** What a project holds that the decider-facing methods read, at a call's start. */
export interface DeciderState {
  readonly answers: readonly {
    readonly record: {
      readonly landing: LandingState;
      readonly receipt: AnswerReceipt;
    };
    readonly row: AnswerRow;
  }[];
  readonly asks: ReadonlyMap<AskId, Ask>;
  readonly budgetDays: readonly BudgetDayRow[];
  readonly claims: readonly {
    readonly row: ClaimRow;
    readonly state: ClaimState;
  }[];
  readonly decisions: readonly Decision[];
  readonly landings: readonly LandingView[];
  readonly policy: Option.Option<Policy>;
  readonly project: Option.Option<ProjectRow>;
  readonly proposals: readonly Proposal[];
}

/** What a decider-facing call writes, beside what the core loop writes. */
export interface DeciderWrites {
  /** Keyed by day and decider. */
  readonly budgetDays: Map<string, BudgetDayRow>;
  readonly decisions: Map<DecisionId, Decision>;
  readonly events: ProjectEventInput[];
  readonly landings: LandingView[];
  readonly outbox: OutboxRow[];
  readonly project: Map<"row", ProjectRow>;
  readonly proposals: Map<ProposalId, Proposal>;
}

/** An ask to open from its files, red first, as `openAsk` or an accepted proposal does. */
export interface Opening {
  readonly ask: AskId;
  /** Who asks it: `askedBy`, and the landing's author. */
  readonly asker: Handle;
  /** The agents the landing discloses (`Assisted-by:`): the platform's drafter, for a drafted ask. */
  readonly assisted: readonly AgentTrailer[];
  readonly credits: readonly Credit[];
  /** Who must decide for its territory. */
  readonly decider: Person;
  readonly files: Array.NonEmptyReadonlyArray<ComposedFile>;
}

/** The refusals opening an ask can give. */
export type OpenRefusal =
  | NotDecider
  | NotRedFirst
  | WeakCheck
  | IncompleteBrief
  | TouchedJudge
  | VerifierBlocked
  | StaleBase;

/** The refusals waiting lifts: the call that met one fails, and is tried again. */
export type WaitRefusal = VerifierBlocked | StaleBase;

/** The refusals opening an ask gives that waiting does not lift. */
type FinalOpenRefusal = Exclude<OpenRefusal, WaitRefusal>;

/** A refusal that declines the proposal whose ask met it. */
const declines = (refusal: FinalOpenRefusal) => Effect.succeedSome(refusal);

/** The ports the decider-facing methods call, besides the store. */
export type DeciderPorts = CheckRunner | Lander | RepoHost;

/**
 * What the project service lends the decider-facing methods: its hydrate,
 * its one-call write, and the helpers the core loop already has. `H` and
 * `W` are the service's own state and writes.
 */
export interface DeciderKernel<
  H extends DeciderState,
  W extends DeciderWrites,
> {
  /** One reported step of an answer, under the call's lock (`advanceAnswer`'s body). */
  readonly advance: (
    h: H,
    writes: W,
    now: DateTime.Utc,
    requestId: RequestId,
    command: LandingCommand
  ) => Effect.Effect<Advanced>;
  /** A new answer request, queued and started on `main`, with its receipt. */
  readonly enqueue: (
    writes: W,
    request: Request,
    input: {
      readonly ask: AskId;
      readonly main: LandedSha;
      readonly now: DateTime.Utc;
    }
  ) => Effect.Effect<AnswerReceipt>;
  readonly name: ProjectName;
  /** An ask opened from its files, red first, and landed. */
  readonly open: (
    h: H,
    writes: W,
    now: DateTime.Utc,
    opening: Opening
  ) => Effect.Effect<
    { readonly ask: Ask; readonly landed: LandedSha },
    OpenRefusal
  >;
  /** The project row at a new landed SHA, with the policy read there. */
  readonly policyAt: (
    row: ProjectRow,
    at: LandedSha,
    now: DateTime.Utc
  ) => Effect.Effect<ProjectRow>;
  readonly read: Effect.Effect<H>;
  /** The env a check of unlanded code carries (`ProjectEnv.runEnv`). */
  readonly runEnv: Effect.Effect<UnlandedRunEnv>;
  /** A push's stage 0–1 facts with the layer paths and whether the pusher reads a layer (`ProjectVisibility`). */
  readonly withLayers: (facts: PushFacts) => Effect.Effect<PushFacts>;
  /** A repo's URL at the gateway. */
  readonly remote: (fork: RepoName) => Effect.Effect<string>;
  /** The canonical repo. */
  readonly repo: RepoName;
  readonly withPorts: <A, E>(
    effect: Effect.Effect<A, E, DeciderPorts>
  ) => Effect.Effect<A, E>;
  readonly write: <A, E>(
    queue: AnswerQueue,
    body: (h: H, writes: W, now: DateTime.Utc) => Effect.Effect<A, E>
  ) => Effect.Effect<A, E>;
}

// ------------------------------------------------------------ pure helpers

const mainRef = "refs/heads/main";

const mainRefName = RefName.make(mainRef);

/** The config folder, as a path prefix. */
const configFolder = `${Brand.configDir}/`;

/** How many steps a decider's land takes at most: merges, checks and lands, with re-merges. */
const landTurns = 16;

/** Whether `handle` decides for any paths in the project. */
export const isDecider = (policy: Policy, handle: Handle) =>
  policy.deciders.some(({ handles }) =>
    handles.some((each) => sameHandle(each, handle))
  );

/**
 * Whether `handle` decides for the ask's territory: a deciders entry whose
 * glob holds one of the territory's globs, each read as the path it spells
 * (`packages/**` holds `packages/parser/**`; `**` holds every territory).
 */
export const decidesOn = (policy: Policy, ask: Ask, handle: Handle) =>
  decidersFor(
    policy,
    ask.territory.paths.map((glob) => RepoPath.make(glob))
  ).some((each) => sameHandle(each, handle));

/** The handle as the policy spells it among its deciders: how decisions name them. */
const asDecider = (policy: Policy, handle: Handle): Option.Option<Handle> =>
  Array.findFirst(
    policy.deciders.flatMap(({ handles }) => handles),
    (each) => sameHandle(each, handle)
  );

/** A table's rows as this call has them: written ones in place of hydrated ones, new ones after. */
const overlaid = <K, V extends { readonly id: K }>(
  rows: readonly V[],
  written: ReadonlyMap<K, V>
): readonly V[] => [
  ...rows.map((row) => written.get(row.id) ?? row),
  ...[...written.values()].filter(
    (row) => !rows.some(({ id }) => id === row.id)
  ),
];

/** The next id of a project's sequence: `prop-000001` after none taken. */
const minted = (prefix: string, taken: number) =>
  `${prefix}-${String(taken + 1).padStart(6, "0")}`;

/** A person's working fork, `<project>--me--<handle in lowercase>`. */
const workingFork = (project: ProjectName, handle: Handle) =>
  RepoName.make(`${project}--me--${handle.toLowerCase()}`);

/** The module a proposal's territory names: by its name, or by its folder. */
const moduleOf = (policy: Policy, territory: string) =>
  Array.findFirst(
    policy.modules,
    (module) =>
      module.module === territory ||
      module.paths.some((glob) => glob === `${territory}/**`)
  );

/**
 * The paths whose deciders decide a proposal: its territory's globs read as
 * paths, since opening the ask needs a decider of its territory (`openAsk`'s
 * rule); without a territory, its files outside the config folder, where
 * its check lives. The ask file's own place says nothing of its territory.
 */
export const pathsOf = (
  policy: Policy,
  files: readonly RepoPath[],
  territory: Option.Option<string>
): readonly RepoPath[] =>
  Option.match(territory, {
    onNone: () => files.filter((path) => !path.startsWith(configFolder)),
    onSome: (named) =>
      Option.match(moduleOf(policy, named), {
        onNone: () => [RepoPath.make(named)],
        onSome: ({ paths }) => paths.map((glob) => RepoPath.make(glob)),
      }),
  });

/**
 * Who decides on `paths`: their deciders, else the project's own (`**`),
 * else its initializer. A decision always has someone.
 */
export const decidersOn = (
  policy: Policy,
  paths: readonly RepoPath[],
  initializer: Handle
): Array.NonEmptyReadonlyArray<Handle> => {
  const named = decidersFor(policy, paths);

  const any = Array.isReadonlyArrayNonEmpty(named)
    ? named
    : decidersFor(policy, []);

  return Array.isReadonlyArrayNonEmpty(any) ? any : Array.of(initializer);
};

const proposedLabel = "want";

/** The evidence line that names the model a proposal's files were drafted by. */
const draftedByLabel = "drafted by";

/** The platform's drafter, as the landing of an ask it drafted discloses it. */
export const drafterOf = (model: string): AgentTrailer => ({
  harness: `${Brand.cli}-drafter`,
  model,
  verified: true,
});

/**
 * The agents an accepted proposal's landing discloses: the drafter, when
 * its decision's evidence says the files were drafted (`drafted by:
 * <model>, attempt <n> of 3`), else none.
 */
const assistedBy = (evidence: readonly Evidence[]): readonly AgentTrailer[] =>
  Option.toArray(
    Option.map(
      Array.findFirst(evidence, ({ label }) => label === draftedByLabel),
      ({ value }) => drafterOf(value.split(", attempt ")[0] ?? value)
    )
  );

/**
 * A proposal's evidence: its want, its territory, and each file it would
 * add, path by content. The decider judges the check as part of the ask, so
 * the files are shown; a sealed answer's diff never is.
 */
const evidenceOf = (input: {
  readonly files: readonly ComposedFile[];
  readonly sealed: boolean;
  readonly territory: Option.Option<string>;
  readonly want: string;
}): readonly Evidence[] => [
  { label: proposedLabel, value: input.want },
  ...Option.toArray(
    Option.map(input.territory, (value): Evidence => ({
      label: "territory",
      value,
    }))
  ),
  ...input.files.map(({ content, path }) => ({ label: path, value: content })),
  ...(input.sealed
    ? [
        {
          label: "sealed answer",
          value:
            "a commit in the proposer's working fork, judged first once the ask opens",
        },
      ]
    : []),
];

/** The files a proposal holds, read back from its decision's evidence by path. */
const filesOf = (
  proposal: Proposal,
  evidence: readonly Evidence[]
): readonly ComposedFile[] =>
  proposal.files.flatMap((path) =>
    Option.toArray(
      Option.map(
        Array.findFirst(evidence, ({ label }) => label === path),
        ({ value }): ComposedFile => ({ content: value, path })
      )
    )
  );

const askFolder = `${configFolder}asks/`;

const askSuffix = ".ask.ts";

/** The ask a proposal's files open: the one whose ask file they hold. */
export const askIdOf = (files: readonly ComposedFile[]): Option.Option<AskId> =>
  Array.findFirst(files, ({ path }) =>
    path.startsWith(askFolder) && path.endsWith(askSuffix)
      ? Schema.decodeOption(AskId)(
          path.slice(askFolder.length, -askSuffix.length)
        )
      : Option.none()
  );

/** When a person claimed. */
interface FirstClaim {
  readonly at: DateTime.Utc;
  readonly handle: Handle;
}

/** Each person's first claim in the project, for Today's newcomers. */
const firstClaimsOf = (claims: DeciderState["claims"]): readonly FirstClaim[] =>
  Array.dedupeWith(
    Array.sort(
      claims.flatMap(({ row, state }): FirstClaim[] =>
        ClaimState.guards.Open(state)
          ? []
          : [{ at: state.openedAt, handle: row.claimant }]
      ),
      Order.mapInput(DateTime.Order, ({ at }: FirstClaim) => at)
    ),
    (one: FirstClaim, other: FirstClaim) => sameHandle(one.handle, other.handle)
  );

const isTouchedJudge = (refusal: Refusal) =>
  Match.value(refusal).pipe(
    Match.tag("TouchedJudge", () => true),
    Match.orElse(() => false)
  );

const staleOf = (refusal: Refusal): Option.Option<StaleBase> =>
  Match.value(refusal).pipe(
    Match.tag("StaleBase", (stale) => Option.some(stale)),
    Match.orElse(() => Option.none())
  );

/** A decision's subject an answer waits on, if it is one. */
const answerDecisionOf = (subject: DecisionSubject) =>
  Schema.decodeUnknownOption(Schema.toType(AnswerDecision))(subject);

/** A commit message's first line as its subject, the rest as its body. */
const messageParts = (message: string) => {
  const [subject = "", ...rest] = message.trim().split("\n");

  return { body: rest.join("\n").trim(), subject: subject.trim() };
};

/** `message` with one more trailer in its trailer block, which `formatLanding` always ends with. */
const withTrailer = (message: string, key: string, value: string) =>
  `${message}${key}: ${value}\n`;

/**
 * The vouch file with `handle`'s lines replaced by one line: `handle`, or
 * `-handle` to denounce, and the note after a space. Every other line
 * stays as it was, comments included.
 */
const vouchedText = (
  text: string,
  input: {
    readonly handle: Handle;
    readonly note: Option.Option<string>;
    readonly verdict: "vouch" | "denounce";
  }
) => {
  const kept = text.split("\n").filter((line) =>
    Array.match(parseVouchFile(line).vouches, {
      onEmpty: () => true,
      onNonEmpty: ([vouch]) => !sameHandle(vouch.handle, input.handle),
    })
  );

  const last = kept.findLastIndex((line) => line.trim() !== "");
  const lines = kept.slice(0, last + 1);
  const sign = input.verdict === "denounce" ? "-" : "";

  const note = Option.match(
    Option.filter(
      Option.map(input.note, (said) => said.replaceAll(/\s+/gu, " ").trim()),
      (said) => said !== ""
    ),
    { onNone: () => "", onSome: (said) => ` ${said}` }
  );

  return `${[...lines, `${sign}${input.handle}${note}`].join("\n")}\n`;
};

/** git's zero id: the `before` of a push that created its ref. */
const zeroId = CommitSha.make("0".repeat(40));

/**
 * The decision a move of canonical `main` the platform did not make opens:
 * `StrayPush`, whose default is revert, for the project's
 * own deciders (`**`), else its initializer, with `before` as git's zero id
 * when the push created `main`. The service mints the id; a `main` moved to
 * a landing or to the landed SHA is the platform's, and opens none.
 */
export const strayDecision = (input: {
  readonly after: CommitSha;
  readonly before: Option.Option<CommitSha>;
  readonly id: DecisionId;
  readonly initializer: Handle;
  readonly now: DateTime.Utc;
  readonly policy: Policy;
  readonly project: ProjectName;
}): Decision =>
  openDecision({
    deciders: decidersOn(input.policy, [], input.initializer),
    evidence: [],
    expireDays: input.policy.budget.expireDays,
    id: input.id,
    now: input.now,
    project: input.project,
    subject: DecisionSubject.cases.StrayPush.make({
      after: input.after,
      before: Option.getOrElse(input.before, () => zeroId),
      ref: RefNameText.make("refs/heads/main"),
    }),
  });

/** The id a project's next decision takes, after the ones `h` and `writes` hold. */
export const nextDecisionId = (
  decisions: readonly Decision[],
  written: ReadonlyMap<DecisionId, Decision>
) => DecisionId.make(minted("dec", overlaid(decisions, written).length));

/** The deadlines a project's proposals and decisions set its alarm to: each open one's expiry. */
export const deciderDeadlines = (h: DeciderState): readonly DateTime.Utc[] => [
  ...h.proposals.flatMap(({ expiresAt, state }) =>
    state === "open" ? [expiresAt] : []
  ),
  ...h.decisions.flatMap(({ decided, expiresAt }) =>
    decided === undefined ? [expiresAt] : []
  ),
];

/** A vouch a decision said yes to that did not land: logged, the decision stands. */
const unlanded = (handle: Handle, refused: NotDecider | StaleBase) =>
  Effect.logWarning(`the vouch for ${handle} did not land`, refused);

/** Who may have a proposal drafted again: its proposer, or a decider of its paths. */
const mayDraft = (
  policy: Policy,
  row: ProjectRow,
  proposal: Proposal,
  handle: Handle
) =>
  sameHandle(proposal.proposer, handle) ||
  decidersOn(
    policy,
    pathsOf(policy, proposal.files, Option.fromUndefinedOr(proposal.territory)),
    row.initializer
  ).some((each) => sameHandle(each, handle));

/** The events among `effects`, written; the alarm is set once settled, from every deadline. */
const emitted = (
  writes: DeciderWrites,
  effects: readonly AttentionEffect[]
) => {
  for (const effect of effects) {
    if (AttentionEffect.$is("Emit")(effect)) {
      writes.events.push(effect.event);
    }
  }
};

// ------------------------------------------------------------ the bodies

/**
 * The decider-facing bodies over a project's kernel. Each write takes the
 * project's answer queue, which a finish's or an answer decision's run is
 * settled on; `expire` runs inside the alarm's own write.
 */
export const deciders = <H extends DeciderState, W extends DeciderWrites>(
  kernel: DeciderKernel<H, W>
) => {
  const { name, repo } = kernel;

  /** The project once it is live: its landed SHA, its row and its policy. */
  const liveOf = (h: H) =>
    Option.flatMap(
      Option.all({ policy: h.policy, row: h.project }),
      ({ policy, row }) =>
        row.state === "live" && row.landed !== undefined
          ? Option.some({ landed: row.landed, policy, row })
          : Option.none()
    );

  /** The project row as this call has it. */
  const rowNow = (h: H, writes: W) =>
    Option.orElse(
      Option.fromUndefinedOr(writes.project.get("row")),
      () => h.project
    );

  const proposalsNow = (h: H, writes: W) =>
    overlaid(h.proposals, writes.proposals);

  const decisionsNow = (h: H, writes: W) =>
    overlaid(h.decisions, writes.decisions);

  /** One more decision or finish spent from `decider`'s budget for the day. */
  const spent = (
    h: H,
    writes: W,
    input: {
      readonly decider: Handle;
      readonly now: DateTime.Utc;
      readonly on: "decision" | "finish";
    }
  ) => {
    const row = spend([...writes.budgetDays.values(), ...h.budgetDays], input);

    writes.budgetDays.set(`${row.day}|${row.decider}`, row);
  };

  /** A landing the platform made outside the answer queue, recorded: its row, its event, the landed SHA moved. */
  const recordLanding = (
    h: H,
    writes: W,
    landing: LandingView,
    now: DateTime.Utc
  ) =>
    Effect.gen(function* () {
      writes.landings.push(landing);
      writes.events.push(ProjectEventInput.Landed({ at: now, landing }));

      const row = rowNow(h, writes);

      if (Option.isSome(row)) {
        writes.project.set(
          "row",
          yield* kernel.policyAt(
            { ...row.value, landed: landing.sha },
            landing.sha,
            now
          )
        );
      }
    });

  /** The text of a file at a commit of the canonical repo, or empty. */
  const textAt = (at: CommitSha, path: RepoPath) =>
    kernel
      .withPorts(
        RepoHost.use((host) =>
          host.readFile(repo, Revision.Commit({ sha: at }), path)
        )
      )
      .pipe(
        Effect.map((bytes) =>
          Option.match(bytes, {
            onNone: () => "",
            onSome: (read) => new TextDecoder().decode(read),
          })
        ),
        Effect.orElseSucceed(() => "")
      );

  // ---------------------------------------------------------- proposals

  /** A proposal opened, with the decision that puts it to its deciders. */
  const putUp = (
    h: H,
    writes: W,
    input: {
      readonly evidence: readonly Evidence[];
      readonly now: DateTime.Utc;
      readonly paths: readonly RepoPath[];
      readonly policy: Policy;
      readonly proposed: Proposed;
      readonly row: ProjectRow;
    }
  ) => {
    const { now, policy, proposed } = input;

    const decision = openDecision({
      deciders: decidersOn(policy, input.paths, input.row.initializer),
      evidence: input.evidence,
      expireDays: policy.budget.expireDays,
      id: DecisionId.make(minted("dec", decisionsNow(h, writes).length)),
      now,
      project: name,
      subject: DecisionSubject.cases.OpenProposal.make({
        proposal: proposed.proposal.id,
      }),
    });

    writes.proposals.set(proposed.proposal.id, proposed.proposal);
    writes.decisions.set(decision.id, decision);
    emitted(writes, proposed.effects);

    return { proposal: proposed.proposal };
  };

  /**
   * A proposal's next draft round started: the proposal drafting, the
   * events `effects` emit, and the row that starts its run, with the note
   * for the agent. No decision goes up until the round settles.
   */
  const startDraft = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: {
      readonly by: Handle;
      readonly effects: readonly AttentionEffect[];
      readonly note: Option.Option<string>;
      readonly proposal: Proposal;
    }
  ) =>
    Effect.gen(function* () {
      const started = yield* Effect.fromResult(
        draft(input.proposal, DraftCommand.DraftStarted({ by: input.by }), now)
      );

      const proposal = Option.getOrElse(
        Option.map(started, (moved) => moved.proposal),
        () => input.proposal
      );

      writes.proposals.set(proposal.id, proposal);
      emitted(writes, input.effects);

      if (
        proposal.draft !== undefined &&
        DraftState.guards.Drafting(proposal.draft)
      ) {
        writes.outbox.push(
          yield* draftRow(
            {
              ...Option.match(input.note, {
                onNone: () => ({}),
                onSome: (note) => ({ note }),
              }),
              project: name,
              proposal: proposal.id,
              round: proposal.draft.round,
            },
            now
          )
        );
      }

      return { proposal };
    });

  /** The proposal by `id` as this call has it. */
  const proposalNow = (h: H, writes: W, id: ProposalId) =>
    Array.findFirst(proposalsNow(h, writes), (each) => each.id === id);

  /** The decision that puts `proposal` to its deciders, the last one when several did. */
  const decisionOf = (h: H, writes: W, proposal: ProposalId) =>
    Array.findLast(
      decisionsNow(h, writes),
      ({ subject }) =>
        DecisionSubject.guards.OpenProposal(subject) &&
        subject.proposal === proposal
    );

  const draftBody =
    (caller: Person, input: Parameters<DeciderApi["draftAsk"]>[1]) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const found = Option.all({
          live: liveOf(h),
          proposal: proposalNow(h, writes, input.proposal),
        });

        if (Option.isNone(found)) {
          return yield* new UnknownProposal({ proposal: input.proposal });
        }

        const { live, proposal } = found.value;

        if (!mayDraft(live.policy, live.row, proposal, caller.handle)) {
          return yield* new NotDecider({});
        }

        return yield* startDraft(h, writes, now, {
          by: caller.handle,
          effects: [],
          note: Option.fromUndefinedOr(input.note),
          proposal,
        });
      });

  /**
   * A draft's round settled, by the pure rules: the proposal moves, and its
   * decision goes up with the files (or the want alone) and what the draft
   * says, or, when one is open already, takes that evidence, and the
   * deciders of the files it now holds, in its place.
   * A stale round or a closed proposal changes nothing.
   */
  const settledBody =
    (input: {
      readonly proposal: ProposalId;
      readonly result: DraftResult;
      readonly round: number;
    }) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const found = Option.all({
          live: liveOf(h),
          proposal: proposalNow(h, writes, input.proposal),
        });

        if (Option.isNone(found)) {
          return;
        }

        const { live, proposal } = found.value;

        const moved = yield* Effect.fromResult(
          draft(
            proposal,
            DraftCommand.DraftSettled({
              result: input.result,
              round: input.round,
            }),
            now
          )
        ).pipe(Effect.orDie);

        if (Option.isNone(moved)) {
          return;
        }

        const settled = moved.value.proposal;
        const territory = Option.fromUndefinedOr(settled.territory);

        const files = DraftResult.match(input.result, {
          Failed: (): readonly ComposedFile[] => [],
          Red: ({ files: drafted }) => drafted,
        });

        const evidence = [
          ...evidenceOf({
            files,
            sealed: false,
            territory,
            want: settled.want,
          }),
          ...moved.value.lines,
        ];

        writes.proposals.set(settled.id, settled);
        emitted(writes, moved.value.effects);

        const open = Option.filter(
          decisionOf(h, writes, settled.id),
          ({ decided }) => decided === undefined
        );

        // The drafted files may lie under other deciders than the want did.
        const decidedBy = decidersOn(
          live.policy,
          pathsOf(live.policy, settled.files, territory),
          live.row.initializer
        );

        if (Option.isSome(open)) {
          writes.decisions.set(open.value.id, {
            ...open.value,
            deciders: decidedBy,
            evidence,
          });

          return;
        }

        const decision = openDecision({
          deciders: decidedBy,
          evidence,
          expireDays: live.policy.budget.expireDays,
          id: DecisionId.make(minted("dec", decisionsNow(h, writes).length)),
          now,
          project: name,
          subject: DecisionSubject.cases.OpenProposal.make({
            proposal: settled.id,
          }),
        });

        writes.decisions.set(decision.id, decision);
      });

  /** A proposal, and the files its decision holds for it (none before one goes up). */
  const proposalOf = (proposal: ProposalId) =>
    Effect.gen(function* () {
      const h = yield* kernel.read;

      const found = Array.findFirst(h.proposals, ({ id }) => id === proposal);

      if (Option.isNone(found)) {
        return yield* new UnknownProposal({ proposal });
      }

      const evidence = Option.match(
        Array.findLast(
          h.decisions,
          ({ subject }) =>
            DecisionSubject.guards.OpenProposal(subject) &&
            subject.proposal === proposal
        ),
        { onNone: () => [], onSome: (decision) => decision.evidence }
      );

      return {
        files: filesOf(found.value, evidence),
        proposal: found.value,
      };
    });

  /** How many of `handle`'s proposals are open. */
  const openCountOf = (h: H, writes: W, handle: Handle) =>
    proposalsNow(h, writes).filter(
      ({ proposer, state }) => state === "open" && sameHandle(proposer, handle)
    ).length;

  const proposeBody =
    (caller: Person, input: Parameters<DeciderApi["proposeAsk"]>[1]) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const live = liveOf(h);

        // Nobody stands vouched before the project has a policy.
        if (Option.isNone(live)) {
          return yield* new NotVouched({});
        }

        const { policy, row } = live.value;
        const who = standing(policy, [], caller.handle);
        const files = input.files ?? [];
        const territory = Option.fromUndefinedOr(input.territory);

        const area = Option.map(territory, (named) =>
          Option.getOrElse(
            Option.map(moduleOf(policy, named), ({ module }) => module),
            () => named
          )
        );

        const recordInArea = Option.match(area, {
          onNone: () => 0,
          onSome: (named) =>
            recordOf({
              asks: h.asks,
              landings: h.landings,
              now,
              policy: policy.record,
              reverted: new Set(),
            })(caller.handle).filter((entry) => entry.area === named).length,
        });

        const proposed = yield* Effect.fromResult(
          propose(
            policy,
            ProposalCommand.Propose({
              denounced: who === "denounced",
              files: files.map(({ path }) => path),
              id: ProposalId.make(
                minted("prop", proposalsNow(h, writes).length)
              ),
              openCount: openCountOf(h, writes, caller.handle),
              project: name,
              recordInArea,
              sealed: Option.map(
                Option.fromUndefinedOr(input.sealed),
                ({ head }) => ({
                  fork: workingFork(name, caller.handle),
                  head,
                })
              ),
              territory,
              vouched: who === "vouched",
              want: input.want,
              who: caller,
            }),
            now
          )
        );

        // A drafted proposal reaches its deciders once its draft settles.
        if (input.draft === true) {
          // A proposal just opened drafts its first round: nothing refuses it.
          return yield* Effect.orDie(
            startDraft(h, writes, now, {
              by: caller.handle,
              effects: proposed.effects,
              note: Option.none(),
              proposal: proposed.proposal,
            })
          );
        }

        return putUp(h, writes, {
          evidence: evidenceOf({
            files,
            sealed: input.sealed !== undefined,
            territory,
            want: input.want,
          }),
          now,
          paths: pathsOf(
            policy,
            files.map(({ path }) => path),
            territory
          ),
          policy,
          proposed,
          row,
        });
      });

  const flagBody =
    (caller: Person, input: Parameters<DeciderApi["flagAsk"]>[1]) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const live = liveOf(h);
        const ask = Option.fromUndefinedOr(h.asks.get(input.ask));

        if (Option.isNone(live) || Option.isNone(ask)) {
          return yield* new UnknownAsk({ ask: input.ask });
        }

        const { policy, row } = live.value;

        const proposed = yield* Effect.fromResult(
          propose(
            policy,
            ProposalCommand.Flag({
              ask: input.ask,
              denounced: standing(policy, [], caller.handle) === "denounced",
              id: ProposalId.make(
                minted("prop", proposalsNow(h, writes).length)
              ),
              openCount: openCountOf(h, writes, caller.handle),
              project: name,
              reason: input.reason,
              who: caller,
            }),
            now
          )
        ).pipe(
          Effect.catchTag("NotVouched", () =>
            Effect.die("a flag needs no vouch")
          )
        );

        return putUp(h, writes, {
          evidence: [
            { label: "ask", value: input.ask },
            { label: "reason", value: input.reason },
          ],
          now,
          paths: ask.value.territory.paths.map((glob) => RepoPath.make(glob)),
          policy,
          proposed,
          row,
        });
      });

  // ---------------------------------------------------------- landings

  /**
   * A platform landing of `files` composed onto main, authored by `author`.
   * A moved main, a busy repo or a blocked Lander is `StaleBase`: try again.
   */
  const landFiles = (
    h: H,
    writes: W,
    input: {
      readonly author: Handle;
      readonly credits: readonly Credit[];
      readonly files: Array.NonEmptyReadonlyArray<ComposedFile>;
      readonly main: LandedSha;
      readonly message: { readonly body: string; readonly subject: string };
      readonly now: DateTime.Utc;
      readonly prefix: string;
    }
  ) =>
    Effect.gen(function* () {
      const { files, main } = input;
      const stale = new StaleBase({ base: main, conflicts: [], main });

      const composed = yield* kernel
        .withPorts(
          Lander.use((lander) => lander.compose({ files, main, repo }))
        )
        .pipe(Effect.mapError(() => stale));

      const requestId = RequestId.make(`${input.prefix}-${composed.tree}`);

      const landed = yield* kernel
        .withPorts(
          Lander.use((lander) =>
            lander.land({
              author: input.author,
              main,
              message: formatLanding({
                assisted: [],
                credits: input.credits,
                requestId,
                ...input.message,
              }),
              rebuild: Rebuild.Compose({ files }),
              repo,
              requestId,
              tree: composed.tree,
              verdict: Option.none(),
            })
          )
        )
        .pipe(
          Effect.catchTags({
            RepoBusy: () => Effect.fail(stale),
            VerifierBlocked: () => Effect.fail(stale),
          })
        );

      yield* recordLanding(
        h,
        writes,
        {
          assisted: [],
          author: input.author,
          credits: input.credits,
          landedAt: input.now,
          parent: main,
          project: name,
          requestId,
          sha: landed.sha,
        },
        input.now
      );

      return landed.sha;
    });

  /**
   * The vouch file landed with `handle` vouched for or denounced, by
   * `by`. A file that already says so lands nothing: the landed SHA.
   */
  const landVouch = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: {
      readonly by: Handle;
      readonly handle: Handle;
      readonly note: Option.Option<string>;
      readonly verdict: "vouch" | "denounce";
    }
  ) =>
    Effect.gen(function* () {
      const live = liveOf(h);

      if (Option.isNone(live)) {
        return yield* new NotDecider({});
      }

      const { landed: main, policy } = live.value;
      const { file } = policy.vouch;
      const before = yield* textAt(main, file);
      const after = vouchedText(before, input);

      if (after === before) {
        return main;
      }

      const said =
        input.verdict === "vouch"
          ? `Vouch for ${input.handle}`
          : `Denounce ${input.handle}`;

      return yield* landFiles(h, writes, {
        author: input.by,
        credits: sameHandle(input.by, platformHandle)
          ? []
          : [{ handle: input.by, role: "Decided-by" }],
        files: Array.of({ content: after, path: file }),
        main,
        message: {
          body: Option.getOrElse(input.note, () => ""),
          subject: said,
        },
        now,
        prefix: "vouch",
      });
    });

  /**
   * A stray push reverted: a platform landing on top of it whose tree is
   * `before`'s, so the stray commits stay in history, with a `Reverts:`
   * trailer. Only `main` lands; any other ref is left for its owner.
   */
  const revert = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: {
      readonly by: Handle;
      readonly stray: Extract<DecisionSubject, { readonly _tag: "StrayPush" }>;
    }
  ) =>
    Effect.gen(function* () {
      const { after, before, ref } = input.stray;

      if (ref !== mainRef) {
        yield* Effect.logWarning(
          `a push to ${ref} was decided revert; only main is reverted`
        );

        return;
      }

      // Putting a deleted main back is a ref update the Lander can't make
      // yet; the landed SHA still names it.
      if (after === zeroId) {
        yield* Effect.logError(
          `canonical ${ref} was deleted; put it back at ${before} by hand`
        );

        return;
      }

      const commit = yield* kernel
        .withPorts(RepoHost.use((host) => host.readCommit(repo, before)))
        .pipe(Effect.orElseSucceed(() => Option.none()));

      if (Option.isNone(commit)) {
        yield* Effect.logWarning(`no commit ${before} to revert to`);

        return;
      }

      const credits: readonly Credit[] = sameHandle(input.by, platformHandle)
        ? []
        : [{ handle: input.by, role: "Decided-by" }];

      const requestId = RequestId.make(`revert-${after}`);

      // The stray commit is main's tip, and the revert's parent.
      const main = LandedSha.make(after);

      const message = withTrailer(
        formatLanding({
          assisted: [],
          body: `A push the platform did not make moved ${ref} from ${before} to ${after}; this landing puts back the tree it replaced.`,
          credits,
          requestId,
          subject: `Revert a push to ${ref}`,
        }),
        "Reverts",
        after
      );

      const landed = yield* kernel
        .withPorts(
          Lander.use((lander) =>
            lander.land({
              author: input.by,
              main,
              message,
              rebuild: Rebuild.Existing({ commit: before }),
              repo,
              requestId,
              tree: TreeSha.make(commit.value.tree),
              verdict: Option.none(),
            })
          )
        )
        .pipe(Effect.option);

      if (Option.isNone(landed)) {
        yield* Effect.logWarning(`the revert of ${after} did not land`);

        return;
      }

      yield* recordLanding(
        h,
        writes,
        {
          assisted: [],
          author: input.by,
          credits,
          landedAt: now,
          parent: main,
          project: name,
          requestId,
          sha: landed.value.sha,
        },
        now
      );
    });

  /**
   * A stray push adopted: its commit becomes the landed SHA, read for rules
   * from now on, decided by `by`.
   */
  const adopt = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: {
      readonly by: Handle;
      readonly stray: Extract<DecisionSubject, { readonly _tag: "StrayPush" }>;
    }
  ) => {
    const { after, before, ref } = input.stray;

    if (after === zeroId) {
      return Effect.logError(
        `canonical ${ref} was deleted; a deleted ${ref} cannot be adopted, so the landed SHA stays`
      );
    }

    return ref === mainRef
      ? recordLanding(
          h,
          writes,
          {
            assisted: [],
            author: input.by,
            credits: [{ handle: input.by, role: "Decided-by" }],
            landedAt: now,
            parent: LandedSha.make(before),
            project: name,
            sha: LandedSha.make(after),
          },
          now
        )
      : Effect.void;
  };

  // ---------------------------------------------------------- answers

  /** An answer's step reported, and its run started again to carry what follows. */
  const advanceAndRun = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    requestId: RequestId,
    command: LandingCommand
  ) =>
    Effect.gen(function* () {
      const advanced = yield* kernel.advance(
        h,
        writes,
        now,
        requestId,
        command
      );

      if (Array.isReadonlyArrayNonEmpty(advanced.effects)) {
        writes.outbox.push(yield* startRow(requestId, now));
      }

      return advanced;
    });

  /** The answer to `ask` that waits on a finish, if one does. */
  const awaitingFinish = (h: H, ask: AskId) =>
    Array.findFirst(
      h.answers,
      ({ record, row }) =>
        row.ask === ask && LandingState.guards.AwaitingFinish(record.landing)
    );

  /** The answers waiting on `decision`, each told what was decided. */
  const answerWaits = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: {
      readonly by: Handle;
      readonly choice: Choice;
      readonly decision: Decision;
    }
  ) =>
    Option.isNone(answerDecisionOf(input.decision.subject))
      ? Effect.void
      : Effect.forEach(
          h.answers.filter(
            ({ record }) =>
              LandingState.guards.AwaitingDecision(record.landing) &&
              record.landing.decisions.some(
                ({ id }) => id === input.decision.id
              )
          ),
          ({ row }) =>
            advanceAndRun(
              h,
              writes,
              now,
              row.requestId,
              LandingCommand.Decided({
                by: input.by,
                choice: input.choice,
                decision: input.decision.id,
              })
            ),
          { discard: true }
        );

  /** An accepted `Finish` decision: the answer waiting at its head lands, finished by `by`. */
  const finishAt = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: {
      readonly ask: AskId;
      readonly by: Handle;
      readonly head: CommitSha;
    }
  ) =>
    Option.match(
      Option.filter(
        awaitingFinish(h, input.ask),
        ({ row }) => row.head === input.head
      ),
      {
        onNone: () => Effect.void,
        onSome: ({ row }) =>
          Effect.asVoid(
            advanceAndRun(
              h,
              writes,
              now,
              row.requestId,
              LandingCommand.Finished({ by: input.by })
            )
          ),
      }
    );

  // ---------------------------------------------------------- decisions

  /**
   * An accepted proposal: its files open its ask red first, asked by the
   * proposer and decided by `by`, and the proposal is accepted. A proposal
   * whose ask cannot open (its check is green on main, its brief lacks a
   * field) is declined, and why is logged: the decider's choice stands. A
   * refusal that waiting lifts (a blocked Checker or Lander, a main that
   * moved) fails the call instead, so nothing is written and the decider
   * can decide again. A flag, or a proposal with no ask file, is accepted
   * and opens nothing; a decider writes the change it asks for.
   */
  const accept = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: {
      readonly by: Handle;
      readonly decision: Decision;
      readonly proposal: ProposalId;
    }
  ) =>
    Effect.gen(function* () {
      const found = Array.findFirst(
        proposalsNow(h, writes),
        ({ id }) => id === input.proposal
      );

      if (Option.isNone(found) || found.value.state !== "open") {
        return;
      }

      const proposal = found.value;
      const files = filesOf(proposal, input.decision.evidence);

      const held: Option.Option<Array.NonEmptyReadonlyArray<ComposedFile>> =
        Array.isReadonlyArrayNonEmpty(files)
          ? Option.some(files)
          : Option.none();

      const opening = Option.all({ ask: askIdOf(files), files: held });

      const toOpen = Option.filter(opening, () => proposal.flags === undefined);

      const refused: Option.Option<FinalOpenRefusal> = yield* Option.match(
        toOpen,
        {
          onNone: () => Effect.succeedNone,
          onSome: ({ ask, files: proposed }) =>
            kernel
              .open(h, writes, now, {
                ask,
                asker: proposal.proposer,
                assisted: assistedBy(input.decision.evidence),
                credits: [
                  { handle: proposal.proposer, role: "Asked-by" },
                  { handle: input.by, role: "Decided-by" },
                ],
                decider: Person.make({ handle: input.by }),
                files: proposed,
              })
              .pipe(
                Effect.as(Option.none<FinalOpenRefusal>()),
                Effect.catchTags({
                  IncompleteBrief: declines,
                  NotDecider: declines,
                  NotRedFirst: declines,
                  TouchedJudge: declines,
                  WeakCheck: declines,
                })
              ),
        }
      );

      if (Option.isSome(refused)) {
        yield* Effect.logWarning(
          `proposal ${proposal.id} was accepted, and its ask could not open`,
          refused.value
        );
      }

      writes.proposals.set(proposal.id, {
        ...proposal,
        state: Option.isSome(refused) ? "declined" : "accepted",
      });
    });

  /** What a decider said yes to, besides a proposal, going ahead. */
  const goAhead = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: { readonly by: Handle; readonly subject: DecisionSubject }
  ): Effect.Effect<void> =>
    DecisionSubject.match(input.subject, {
      Finish: ({ ask, head }) =>
        finishAt(h, writes, now, { ask, by: input.by, head }),
      // The proposal's `OpenAsk` effect opens it.
      OpenProposal: () => Effect.void,
      // The answer waiting on it is told (`answerWaits`).
      PostureChange: () => Effect.void,
      // The env proxy and the value store are the visibility cartridge's.
      ProxyWidened: () => Effect.void,
      RaiseRatchet: () => Effect.void,
      SecretInTree: () => Effect.void,
      StrayPush: (stray) => adopt(h, writes, now, { by: input.by, stray }),
      Vouch: ({ handle }) =>
        landVouch(h, writes, now, {
          by: input.by,
          handle,
          note: Option.none(),
          verdict: "vouch",
        }).pipe(
          Effect.asVoid,
          Effect.catchTags({
            NotDecider: (refused) => unlanded(handle, refused),
            StaleBase: (refused) => unlanded(handle, refused),
          })
        ),
      Waiver: () => Effect.void,
    });

  /**
   * A decision taken, by a decider or by its expiry, settled: its effects
   * (events, an ask opened, a yes gone ahead, a stray push reverted), a
   * proposal a person declined closed, and the answers waiting on it told.
   */
  const settleDecided = (h: H, writes: W, now: DateTime.Utc, taken: Decided) =>
    Effect.gen(function* () {
      const { decision } = taken;
      const { decided } = decision;

      if (decided === undefined) {
        return;
      }

      const { by, choice } = decided;

      yield* Effect.forEach(
        taken.effects,
        (effect) =>
          AttentionEffect.$match(effect, {
            Emit: ({ event }) => Effect.sync(() => writes.events.push(event)),
            Land: ({ subject }) => goAhead(h, writes, now, { by, subject }),
            OpenAsk: ({ proposal }) =>
              accept(h, writes, now, { by, decision, proposal }),
            Revert: () =>
              DecisionSubject.guards.StrayPush(decision.subject)
                ? revert(h, writes, now, { by, stray: decision.subject })
                : Effect.void,
            // The alarm is set once settled, to the earliest deadline of all.
            SetAlarm: () => Effect.void,
          }),
        { discard: true }
      );

      // A proposal a person declined closes; one that expired already has.
      if (DecisionSubject.guards.OpenProposal(decision.subject)) {
        const { proposal } = decision.subject;

        const open = Array.findFirst(
          proposalsNow(h, writes),
          ({ id, state }) => id === proposal && state === "open"
        );

        if (
          Option.isSome(open) &&
          (choice === "decline" || choice === "revert")
        ) {
          writes.proposals.set(proposal, { ...open.value, state: "declined" });
        }
      }

      yield* answerWaits(h, writes, now, { by, choice, decision });
    });

  const decideBody =
    (caller: Person, input: Parameters<DeciderApi["decide"]>[1]) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const by = Option.getOrElse(
          Option.flatMap(h.policy, (policy) =>
            asDecider(policy, caller.handle)
          ),
          () => caller.handle
        );

        const taken = yield* Effect.fromResult(
          decide(decisionsNow(h, writes), {
            by,
            choice: input.choice,
            id: input.decision,
            note: Option.fromUndefinedOr(input.note),
            now,
          })
        );

        writes.decisions.set(taken.decision.id, taken.decision);
        spent(h, writes, { decider: by, now, on: "decision" });

        yield* settleDecided(h, writes, now, taken);

        return { decision: taken.decision };
      });

  /**
   * The alarm fired: every open proposal past its expiry expires, then
   * every open decision past its expiry takes its default, by the
   * platform's hand, and what follows is settled.
   */
  const expire = (h: H, writes: W, now: DateTime.Utc) =>
    Effect.gen(function* () {
      const proposals = proposalsNow(h, writes);
      const expired = expireProposals(proposals, now).proposals;

      for (const [index, proposal] of expired.entries()) {
        if (proposal !== proposals[index]) {
          writes.proposals.set(proposal.id, proposal);
        }
      }

      yield* Effect.forEach(
        decisionsNow(h, writes),
        (decision) => {
          const { decisions, effects } = expireDecisions([decision], now);
          const [defaulted] = decisions;

          if (defaulted === undefined || defaulted === decision) {
            return Effect.void;
          }

          writes.decisions.set(defaulted.id, defaulted);

          // A default is its subject's no (`defaultChoice`), so an
          // expiry never opens an ask, and opening's refusals never arise.
          return settleDecided(h, writes, now, {
            decision: defaulted,
            effects,
          }).pipe(Effect.orDie);
        },
        { discard: true }
      );
    });

  // ---------------------------------------------------------- finish

  const finishBody =
    (caller: Person, input: Parameters<DeciderApi["finish"]>[1]) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const live = liveOf(h);
        const ask = Option.fromUndefinedOr(h.asks.get(input.ask));

        const decides = Option.exists(
          Option.all({ ask, live }),
          ({ ask: asked, live: { policy } }) =>
            decidesOn(policy, asked, caller.handle)
        );

        if (Option.isNone(live) || !decides) {
          return yield* new NotDecider({});
        }

        const { landed: main, policy } = live.value;

        // The decider as the policy spells them, as `decide` and Today do:
        // the budget row and the credit name one person however they sign in.
        const by = Option.getOrElse(
          asDecider(policy, caller.handle),
          () => caller.handle
        );

        const receiptOf = (
          outcome: Outcome,
          requestId = input.requestId
        ): AnswerReceipt => ({
          ask: input.ask,
          base: input.base,
          head: input.head,
          outcome,
          project: name,
          requestId,
        });

        // The same finish again: the request it queued, as it stands.
        const queued = Array.findFirst(
          h.answers,
          ({ row }) =>
            row.requestId === input.requestId && row.ask === input.ask
        );

        if (Option.isSome(queued)) {
          return receiptOf(outcomeOf(queued.value.record.landing));
        }

        const waiting = awaitingFinish(h, input.ask);

        if (Option.isNone(waiting)) {
          // Finished before, at this head: where that answer stands now.
          const answered = Array.findFirst(
            h.answers,
            ({ row }) => row.ask === input.ask && row.head === input.head
          );

          return yield* Option.match(answered, {
            onNone: () =>
              Effect.fail(
                new StaleBase({ base: input.base, conflicts: [], main })
              ),
            onSome: ({ record }) =>
              Effect.succeed(receiptOf(outcomeOf(record.landing))),
          });
        }

        const { record, row } = waiting.value;
        const { request } = record.landing;

        spent(h, writes, { decider: by, now, on: "finish" });

        if (input.head === request.head) {
          const advanced = yield* advanceAndRun(
            h,
            writes,
            now,
            row.requestId,
            LandingCommand.Finished({ by })
          );

          return receiptOf(advanced.outcome);
        }

        // The decider's commits on top: stage 1 over them, then the whole
        // way again from the merge, already finished.
        const stale = new StaleBase({ base: input.base, conflicts: [], main });

        const facts = yield* kernel
          .withPorts(
            pushFacts({
              ask,
              base: input.base,
              claim: Option.none(),
              claimsHeld: 0,
              head: input.head,
              landed: main,
              policy,
              project: name,
              pusher: caller,
              ref: mainRef,
              repo: request.fork,
            })
          )
          .pipe(
            Effect.catchTags({
              MissingCommit: () => Effect.fail(stale),
              RepoNotFound: () => Effect.fail(stale),
            })
          );

        const stageOne = yield* scan.run(facts);
        const judged = Array.findFirst(stageOne, isTouchedJudge);

        if (Option.isSome(judged)) {
          return yield* new TouchedJudge({
            paths: Match.value(judged.value).pipe(
              Match.tag("TouchedJudge", ({ paths }) => paths),
              Match.orElse(() => Array.of(RepoPath.make(mainRef)))
            ),
          });
        }

        if (Array.isReadonlyArrayNonEmpty(stageOne)) {
          return receiptOf(Outcome.cases.Refused.make({ refusals: stageOne }));
        }

        return yield* kernel.enqueue(
          writes,
          {
            ...request,
            base: input.base,
            credits: [...request.credits, { handle: by, role: "Finished-by" }],
            head: input.head,
            requestId: input.requestId,
          },
          { ask: input.ask, main, now }
        );
      });

  // ---------------------------------------------------------- land

  /**
   * A landing request carried as far as it goes within this call: its
   * landing lifecycle moved by each step's report, as the answer queue's
   * run would move it, until it lands, is refused, or must wait.
   */
  const carry = (
    input: {
      /** The env every check job carries: the decider's change is unlanded code. */
      readonly env: UnlandedRunEnv;
      readonly lanes: readonly CheckLane[];
      readonly message: string;
      readonly now: DateTime.Utc;
      /** The project's run block, which every check job carries. */
      readonly run: RunBlock;
    },
    step: Step,
    turns: number
  ): Effect.Effect<LandingState, never, DeciderPorts> =>
    Effect.gen(function* () {
      const next = step.effects.find(isStep);

      if (next === undefined || turns === 0) {
        return step.state;
      }

      const run: AnswerRun = {
        admitted: true,
        env: input.env,
        finish: "optional",
        lanes: input.lanes,
        message: input.message,
        repo,
        run: input.run,
        state: step.state,
      };

      const reported = yield* runStep(run, next);

      if (Option.isNone(reported)) {
        return step.state;
      }

      return yield* carry(
        input,
        transition(step.state, reported.value.command, input.now),
        turns - 1
      );
    });

  const landBody =
    (caller: Person, input: Parameters<DeciderApi["land"]>[1]) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const live = liveOf(h);

        if (
          Option.isNone(live) ||
          !isDecider(live.value.policy, caller.handle)
        ) {
          return yield* new NotDecider({});
        }

        const { landed: main, policy } = live.value;

        const receiptOf = (outcome: Outcome): LandReceipt => ({
          base: input.base,
          head: input.head,
          outcome,
          project: name,
          requestId: input.requestId,
        });

        // The same request again: the landing it made.
        const earlier = Array.findFirst(
          h.landings,
          ({ author, requestId }) =>
            requestId === input.requestId && sameHandle(author, caller.handle)
        );

        if (Option.isSome(earlier)) {
          return receiptOf(
            Outcome.cases.Landed.make({ sha: earlier.value.sha })
          );
        }

        const fork = workingFork(name, caller.handle);
        const stale = new StaleBase({ base: input.base, conflicts: [], main });

        const facts = yield* kernel
          .withPorts(
            pushFacts({
              ask: Option.none(),
              base: input.base,
              claim: Option.none(),
              claimsHeld: 0,
              head: input.head,
              landed: main,
              policy,
              project: name,
              pusher: caller,
              ref: mainRef,
              repo: fork,
            })
          )
          .pipe(
            Effect.catchTags({
              MissingCommit: () => Effect.fail(stale),
              RepoNotFound: () => Effect.fail(stale),
            }),
            Effect.flatMap(kernel.withLayers)
          );

        // A decider lands only in the paths they decide for.
        if (
          facts.changes.some(
            ({ path }) =>
              !decidersFor(policy, [path]).some((each) =>
                sameHandle(each, caller.handle)
              )
          )
        ) {
          return yield* new NotDecider({});
        }

        // Stages 0–1, as for an answer. A decider may change the judge
        // where they decide: that is how a project changes its process.
        const gate = yield* runGate(pushStages, facts);

        const refusals = Option.match(gate, {
          onNone: () => [],
          onSome: (all) => all.filter((refusal) => !isTouchedJudge(refusal)),
        });

        if (Array.isReadonlyArrayNonEmpty(refusals)) {
          return receiptOf(Outcome.cases.Refused.make({ refusals }));
        }

        const credits: readonly Credit[] = [
          { handle: caller.handle, role: "Signed-off-by" },
        ];

        const request: Request = {
          answerer: caller.handle,
          ask: Option.none(),
          assisted: [],
          base: input.base,
          credits,
          fork,
          head: input.head,
          project: name,
          requestId: input.requestId,
        };

        const env = yield* kernel.runEnv;

        const state = yield* kernel.withPorts(
          carry(
            {
              env,
              lanes: Record.toEntries(policy.run.checks).map(
                ([lane, command]) => CheckLane.make({ command, lane })
              ),
              message: formatLanding({
                assisted: [],
                credits,
                requestId: input.requestId,
                ...messageParts(input.message),
              }),
              now,
              run: policy.run,
            },
            transition(
              LandingState.cases.Queued.make({ request }),
              LandingCommand.Start({ main }),
              now
            ),
            landTurns
          )
        );

        if (LandingState.guards.Landed(state)) {
          yield* recordLanding(
            h,
            writes,
            {
              assisted: [],
              author: caller.handle,
              credits,
              landedAt: now,
              parent: main,
              project: name,
              requestId: input.requestId,
              sha: state.sha,
            },
            now
          );

          return receiptOf(outcomeOf(state));
        }

        if (LandingState.guards.Refused(state)) {
          const stuck = Array.findFirst(state.refusals, staleOf);

          return Option.isSome(stuck)
            ? yield* stuck.value
            : receiptOf(outcomeOf(state));
        }

        // A busy repo or a blocked Checker or Lander: try again.
        return yield* new RepoBusy({});
      });

  // ---------------------------------------------------------- fork, vouch

  const forkBody = (caller: Person) => (h: H, writes: W, now: DateTime.Utc) =>
    Effect.gen(function* () {
      const live = liveOf(h);

      if (Option.isNone(live)) {
        return yield* new NotVouched({});
      }

      const { policy } = live.value;
      const who = standing(policy, [], caller.handle);

      if (who === "denounced") {
        return yield* new Denounced({});
      }

      // A working fork carries code, so it needs a vouch, as a claim does.
      if (who === "unknown" && policy.vouch.mode !== "bansOnly") {
        return yield* new NotVouched({});
      }

      const fork = workingFork(name, caller.handle);

      const made = yield* kernel
        .withPorts(RepoHost.use((host) => host.refs(fork)))
        .pipe(
          Effect.map((refs) => refs.has(mainRefName)),
          Effect.orElseSucceed(() => false)
        );

      if (!made) {
        writes.outbox.push(
          yield* outboxRow(
            `fork:${fork}`,
            OutboxBody.cases.MakeFork.make({ from: repo, name: fork }),
            now
          )
        );
      }

      return { fork, remote: yield* kernel.remote(fork) };
    });

  const vouchBody =
    (caller: Person, input: Parameters<DeciderApi["vouch"]>[1]) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const policy = Option.getOrUndefined(h.policy);

        // Whoever decides for the vouch file vouches.
        if (
          policy === undefined ||
          !decidersFor(policy, [policy.vouch.file]).some((each) =>
            sameHandle(each, caller.handle)
          )
        ) {
          return yield* new NotDecider({});
        }

        const landed = yield* landVouch(h, writes, now, {
          by: caller.handle,
          handle: input.handle,
          note: Option.fromUndefinedOr(input.note),
          verdict: input.verdict,
        });

        return { landed };
      });

  // ---------------------------------------------------------- reads

  const todayOf = (caller: Person) =>
    Effect.gen(function* () {
      const h = yield* kernel.read;
      const now = yield* DateTime.now;

      const found = Option.flatMap(h.policy, (policy) =>
        Option.map(asDecider(policy, caller.handle), (decider) => ({
          decider,
          policy,
        }))
      );

      if (Option.isNone(found)) {
        return yield* new NotDecider({});
      }

      const { decider, policy } = found.value;

      return today({
        budget: budgetFor(policy, decider, h.budgetDays, now),
        decider,
        decisions: h.decisions,
        firstClaims: firstClaimsOf(h.claims),
        landings: h.landings,
        now,
      });
    });

  return {
    credits: (handle: Handle) =>
      Effect.map(kernel.read, (h) => ({
        credits: creditsByArea({ asks: h.asks, handle, landings: h.landings }),
      })),
    decide: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["decide"]>[1]
    ) => kernel.write(queue, decideBody(caller, input)),
    draftAsk: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["draftAsk"]>[1]
    ) => kernel.write(queue, draftBody(caller, input)),
    draftSettled: (
      queue: AnswerQueue,
      input: {
        readonly proposal: ProposalId;
        readonly result: DraftResult;
        readonly round: number;
      }
    ) => kernel.write(queue, settledBody(input)),
    expire,
    finish: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["finish"]>[1]
    ) => kernel.write(queue, finishBody(caller, input)),
    flagAsk: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["flagAsk"]>[1]
    ) => kernel.write(queue, flagBody(caller, input)),
    fork: (queue: AnswerQueue, caller: Person) =>
      kernel.write(queue, forkBody(caller)),
    land: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["land"]>[1]
    ) => kernel.write(queue, landBody(caller, input)),
    proposeAsk: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["proposeAsk"]>[1]
    ) => kernel.write(queue, proposeBody(caller, input)),
    showProposal: proposalOf,
    today: todayOf,
    vouch: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["vouch"]>[1]
    ) => kernel.write(queue, vouchBody(caller, input)),
  };
};
