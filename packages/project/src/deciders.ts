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
import { listingOf as discussionListingOf } from "@repo/protocol/domain/discussion";
import type {
  Discussion,
  DiscussionListing,
} from "@repo/protocol/domain/discussion";
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
  DiscussionId,
  LandedSha,
  ProposalId,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
  keyOf,
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
  UnknownDiscussion,
  UnknownProposal,
} from "@repo/protocol/refusal";
import type {
  CapReached,
  DecisionClosed,
  DiscussionClosed,
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
import { creditsByArea } from "./attention/credits.ts";
import {
  decide,
  decidersFor,
  expireDecisions,
  openDecision,
} from "./attention/decisions.ts";
import type { Decided } from "./attention/decisions.ts";
import { DiscussionCommand, post, promoted } from "./attention/discussions.ts";
import { AttentionEffect, platformHandle } from "./attention/effects.ts";
import {
  draft,
  DraftCommand,
  draftFailedLabel,
  expire as expireProposals,
  propose,
  ProposalCommand,
} from "./attention/proposals.ts";
import type { Proposed } from "./attention/proposals.ts";
import { recordOf } from "./attention/record.ts";
import { today } from "./attention/today.ts";
import { capped, standing } from "./attention/vouch.ts";
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
import { MetricPoint, millisBetween } from "./metrics.ts";
import {
  draftRow,
  measuredRow,
  OutboxBody,
  outboxRow,
  startRow,
} from "./outbox.ts";
import type {
  AnswerRow,
  ClaimRow,
  OutboxRow,
  ProjectRow,
} from "./project-store/rows.ts";

/** Lint keeps "shape" out of code names, so the name is spelled once, here. */
export const envSchemaMethod = "envShape";

export interface DeciderApi {
  readonly [envSchemaMethod]: (
    caller: Principal
  ) => Effect.Effect<EnvSchemaView, UnknownProject>;
  readonly credits: (
    caller: Principal,
    handle: Handle
  ) => Effect.Effect<{ readonly credits: readonly CreditSummary[] }>;
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
  readonly flagAsk: (
    caller: Person,
    input: { readonly ask: AskId; readonly reason: string }
  ) => Effect.Effect<
    { readonly proposal: Proposal },
    UnknownAsk | Denounced | CapReached
  >;
  readonly fork: (
    caller: Person
  ) => Effect.Effect<
    { readonly fork: RepoName; readonly remote: string },
    NotVouched | Denounced
  >;
  readonly land: (
    caller: Person,
    input: {
      readonly base: CommitSha;
      readonly head: CommitSha;
      readonly message: string;
      readonly requestId: RequestId;
    }
  ) => Effect.Effect<LandReceipt, NotDecider | StaleBase | RepoBusy>;
  readonly ledger: (caller: Principal) => Effect.Effect<Ledger>;
  readonly listDiscussions: (
    caller: Principal
  ) => Effect.Effect<{ readonly discussions: readonly DiscussionListing[] }>;
  readonly postDiscussion: (
    caller: Person,
    input: {
      readonly body?: string;
      readonly discussion?: DiscussionId;
      readonly title?: string;
    }
  ) => Effect.Effect<
    { readonly discussion: Discussion },
    UnknownDiscussion | DiscussionClosed | Denounced | CapReached
  >;
  readonly proposeAsk: (
    caller: Person,
    input: {
      readonly discussion?: DiscussionId;
      readonly draft?: true;
      readonly files?: Array.NonEmptyReadonlyArray<ComposedFile>;
      readonly sealed?: { readonly head: CommitSha };
      readonly territory?: string;
      readonly want: string;
    }
  ) => Effect.Effect<
    { readonly proposal: Proposal },
    | Denounced
    | CapReached
    | NotVouched
    | NotDecider
    | UnknownDiscussion
    | DiscussionClosed
  >;
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
  readonly draftAsk: (
    caller: Person,
    input: { readonly note?: string; readonly proposal: ProposalId }
  ) => Effect.Effect<
    { readonly proposal: Proposal },
    UnknownProposal | ProposalClosed | NotDecider | DraftInProgress | CapReached
  >;
  readonly showDiscussion: (
    caller: Principal,
    discussion: DiscussionId
  ) => Effect.Effect<{ readonly discussion: Discussion }, UnknownDiscussion>;
  readonly showProposal: (
    caller: Principal,
    proposal: ProposalId
  ) => Effect.Effect<
    { readonly files: readonly ConfigFile[]; readonly proposal: Proposal },
    UnknownProposal
  >;
  readonly today: (caller: Person) => Effect.Effect<Today, NotDecider>;
  readonly vouch: (
    caller: Person,
    input: {
      readonly handle: Handle;
      readonly note?: string;
      readonly verdict: "vouch" | "denounce";
    }
  ) => Effect.Effect<{ readonly landed: LandedSha }, NotDecider | StaleBase>;
}

export interface DeciderState {
  readonly answers: readonly {
    readonly record: {
      readonly landing: LandingState;
      readonly receipt: AnswerReceipt;
    };
    readonly row: AnswerRow;
  }[];
  readonly asks: ReadonlyMap<AskId, Ask>;
  readonly claims: readonly {
    readonly row: ClaimRow;
    readonly state: ClaimState;
  }[];
  readonly decisions: readonly Decision[];
  readonly discussions: readonly Discussion[];
  readonly landings: readonly LandingView[];
  readonly policy: Option.Option<Policy>;
  readonly project: Option.Option<ProjectRow>;
  readonly proposals: readonly Proposal[];
}

export interface DeciderWrites {
  readonly decisions: Map<DecisionId, Decision>;
  readonly discussions: Map<DiscussionId, Discussion>;
  readonly events: ProjectEventInput[];
  readonly landings: LandingView[];
  readonly outbox: OutboxRow[];
  readonly project: Map<"row", ProjectRow>;
  readonly proposals: Map<ProposalId, Proposal>;
}

export interface Opening {
  readonly ask: AskId;
  readonly asker: Handle;
  readonly assisted: readonly AgentTrailer[];
  readonly credits: readonly Credit[];
  readonly decider: Person;
  readonly files: Array.NonEmptyReadonlyArray<ComposedFile>;
}

export type OpenRefusal =
  | NotDecider
  | NotRedFirst
  | WeakCheck
  | IncompleteBrief
  | TouchedJudge
  | VerifierBlocked
  | StaleBase;

export type WaitRefusal = VerifierBlocked | StaleBase;

type FinalOpenRefusal = Exclude<OpenRefusal, WaitRefusal>;

const declines = (refusal: FinalOpenRefusal) => Effect.succeedSome(refusal);

export type DeciderPorts = CheckRunner | Lander | RepoHost;

export interface DeciderKernel<
  H extends DeciderState,
  W extends DeciderWrites,
> {
  readonly advance: (
    h: H,
    writes: W,
    now: DateTime.Utc,
    requestId: RequestId,
    command: LandingCommand
  ) => Effect.Effect<Advanced>;
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
  readonly open: (
    h: H,
    writes: W,
    now: DateTime.Utc,
    opening: Opening
  ) => Effect.Effect<
    { readonly ask: Ask; readonly landed: LandedSha },
    OpenRefusal
  >;
  readonly policyAt: (
    row: ProjectRow,
    at: LandedSha,
    now: DateTime.Utc
  ) => Effect.Effect<ProjectRow>;
  readonly read: Effect.Effect<H>;
  readonly runEnv: Effect.Effect<UnlandedRunEnv>;
  readonly withLayers: (facts: PushFacts) => Effect.Effect<PushFacts>;
  readonly remote: (fork: RepoName) => Effect.Effect<string>;
  readonly repo: RepoName;
  readonly withPorts: <A, E>(
    effect: Effect.Effect<A, E, DeciderPorts>
  ) => Effect.Effect<A, E>;
  readonly write: <A, E>(
    queue: AnswerQueue,
    body: (h: H, writes: W, now: DateTime.Utc) => Effect.Effect<A, E>
  ) => Effect.Effect<A, E>;
}

const mainRef = "refs/heads/main";

const mainRefName = RefName.make(mainRef);

const configFolder = `${Brand.configDir}/`;

const landTurns = 16;

export const isDecider = (policy: Policy, handle: Handle) =>
  policy.deciders.some(({ handles }) =>
    handles.some((each) => sameHandle(each, handle))
  );

export const decidesOn = (policy: Policy, ask: Ask, handle: Handle) =>
  decidersFor(
    policy,
    ask.territory.paths.map((glob) => RepoPath.make(glob))
  ).some((each) => sameHandle(each, handle));

const asDecider = (policy: Policy, handle: Handle): Option.Option<Handle> =>
  Array.findFirst(
    policy.deciders.flatMap(({ handles }) => handles),
    (each) => sameHandle(each, handle)
  );

const overlaid = <K, V extends { readonly id: K }>(
  rows: readonly V[],
  written: ReadonlyMap<K, V>
): readonly V[] => [
  ...rows.map((row) => written.get(row.id) ?? row),
  ...[...written.values()].filter(
    (row) => !rows.some(({ id }) => id === row.id)
  ),
];

const minted = (prefix: string, taken: number) =>
  `${prefix}-${String(taken + 1).padStart(6, "0")}`;

const workingFork = (project: ProjectName, handle: Handle) =>
  RepoName.make(`${keyOf(project)}--me--${handle.toLowerCase()}`);

const moduleOf = (policy: Policy, territory: string) =>
  Array.findFirst(
    policy.modules,
    (module) =>
      module.module === territory ||
      module.paths.some((glob) => glob === `${territory}/**`)
  );

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

const draftedByLabel = "drafted by";

export const drafterOf = (model: string): AgentTrailer => ({
  harness: `${Brand.cli}-drafter`,
  model,
  verified: true,
});

/** A round from its start to its settle: the proposal names its start while it drafts. */
const draftedPoints = (
  proposal: Proposal,
  result: DraftResult,
  now: DateTime.Utc
): readonly MetricPoint[] =>
  proposal.draft !== undefined && DraftState.guards.Drafting(proposal.draft)
    ? [
        MetricPoint.cases.Drafted.make({
          attempts: result.attempts,
          latencyMs: millisBetween(proposal.draft.startedAt, now),
          project: proposal.project,
          ready: DraftResult.guards.Red(result),
        }),
      ]
    : [];

const assistedBy = (evidence: readonly Evidence[]): readonly AgentTrailer[] =>
  Option.toArray(
    Option.map(
      Array.findFirst(evidence, ({ label }) => label === draftedByLabel),
      ({ value }) => drafterOf(value.split(", attempt ")[0] ?? value)
    )
  );

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

export const askIdOf = (files: readonly ComposedFile[]): Option.Option<AskId> =>
  Array.findFirst(files, ({ path }) =>
    path.startsWith(askFolder) && path.endsWith(askSuffix)
      ? Schema.decodeOption(AskId)(
          path.slice(askFolder.length, -askSuffix.length)
        )
      : Option.none()
  );

interface FirstClaim {
  readonly at: DateTime.Utc;
  readonly handle: Handle;
}

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

const answerDecisionOf = (subject: DecisionSubject) =>
  Schema.decodeUnknownOption(Schema.toType(AnswerDecision))(subject);

const messageParts = (message: string) => {
  const [subject = "", ...rest] = message.trim().split("\n");

  return { body: rest.join("\n").trim(), subject: subject.trim() };
};

const withTrailer = (message: string, key: string, value: string) =>
  `${message}${key}: ${value}\n`;

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

const zeroId = CommitSha.make("0".repeat(40));

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
    expireDays: input.policy.decisions.expireDays,
    id: input.id,
    now: input.now,
    project: input.project,
    subject: DecisionSubject.cases.StrayPush.make({
      after: input.after,
      before: Option.getOrElse(input.before, () => zeroId),
      ref: RefNameText.make("refs/heads/main"),
    }),
  });

export const nextDecisionId = (
  decisions: readonly Decision[],
  written: ReadonlyMap<DecisionId, Decision>
) => DecisionId.make(minted("dec", overlaid(decisions, written).length));

export const deciderDeadlines = (h: DeciderState): readonly DateTime.Utc[] => [
  ...h.proposals.flatMap(({ expiresAt, state }) =>
    state === "open" ? [expiresAt] : []
  ),
  ...h.decisions.flatMap(({ decided, expiresAt }) =>
    decided === undefined ? [expiresAt] : []
  ),
];

const unlanded = (handle: Handle, refused: NotDecider | StaleBase) =>
  Effect.logWarning(`the vouch for ${handle} did not land`, refused);

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

export const deciders = <H extends DeciderState, W extends DeciderWrites>(
  kernel: DeciderKernel<H, W>
) => {
  const { name, repo } = kernel;

  const liveOf = (h: H) =>
    Option.flatMap(
      Option.all({ policy: h.policy, row: h.project }),
      ({ policy, row }) =>
        row.state === "live" && row.landed !== undefined
          ? Option.some({ landed: row.landed, policy, row })
          : Option.none()
    );

  const rowNow = (h: H, writes: W) =>
    Option.orElse(
      Option.fromUndefinedOr(writes.project.get("row")),
      () => h.project
    );

  const proposalsNow = (h: H, writes: W) =>
    overlaid(h.proposals, writes.proposals);

  const decisionsNow = (h: H, writes: W) =>
    overlaid(h.decisions, writes.decisions);

  const discussionsNow = (h: H, writes: W) =>
    overlaid(h.discussions, writes.discussions);

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
      expireDays: policy.decisions.expireDays,
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
        draft(
          input.proposal,
          DraftCommand.DraftStarted({
            by: input.by,
            ...Option.match(input.note, {
              onNone: () => ({}),
              onSome: (note) => ({ note }),
            }),
          }),
          now
        )
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

  const proposalNow = (h: H, writes: W, id: ProposalId) =>
    Array.findFirst(proposalsNow(h, writes), (each) => each.id === id);

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

        const open = Option.filter(
          decisionOf(h, writes, settled.id),
          ({ decided }) => decided === undefined
        );

        // A failed round that kept files keeps the decision that holds them.
        const kept = Option.filter(
          Option.map(open, ({ evidence: earlier }) =>
            earlier.filter(({ label }) => label !== draftFailedLabel)
          ),
          () =>
            DraftResult.guards.Failed(input.result) && settled.files.length > 0
        );

        const evidence = [
          ...Option.getOrElse(kept, () =>
            evidenceOf({
              files,
              sealed: false,
              territory,
              want: settled.want,
            })
          ),
          ...moved.value.lines,
        ];

        writes.proposals.set(settled.id, settled);
        emitted(writes, moved.value.effects);

        // A settle moves only the round still drafting, so a replayed one counts nothing.
        writes.outbox.push(
          ...(yield* measuredRow(
            `drafted:${settled.id}:r${input.round}`,
            draftedPoints(proposal, input.result, now),
            now
          ))
        );

        // The drafted files may lie under other maintainers than the want did.
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
          expireDays: live.policy.decisions.expireDays,
          id: DecisionId.make(minted("dec", decisionsNow(h, writes).length)),
          now,
          project: name,
          subject: DecisionSubject.cases.OpenProposal.make({
            proposal: settled.id,
          }),
        });

        writes.decisions.set(decision.id, decision);
      });

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

        const id = ProposalId.make(
          minted("prop", proposalsNow(h, writes).length)
        );

        // Only a maintainer turns a thread into a proposal, and only an open one.
        const fromThread = yield* Option.match(
          Option.fromUndefinedOr(input.discussion),
          {
            onNone: () => Effect.succeedNone,
            onSome: (named) =>
              Effect.gen(function* () {
                const thread = Array.findFirst(
                  discussionsNow(h, writes),
                  (each) => each.id === named
                );

                if (Option.isNone(thread)) {
                  return yield* new UnknownDiscussion({ discussion: named });
                }

                if (!isDecider(policy, caller.handle)) {
                  return yield* new NotDecider({});
                }

                return Option.some(
                  yield* Effect.fromResult(promoted(thread.value, id))
                );
              }),
          }
        );

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
              capped: capped(who),
              denounced: who === "denounced",
              files: files.map(({ path }) => path),
              id,
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

        if (Option.isSome(fromThread)) {
          writes.discussions.set(fromThread.value.id, fromThread.value);
        }

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

  const openDiscussionsOf = (h: H, writes: W, handle: Handle) =>
    discussionsNow(h, writes).filter(
      ({ opener, state }) => state === "open" && sameHandle(opener, handle)
    ).length;

  const postBody =
    (caller: Person, input: Parameters<DeciderApi["postDiscussion"]>[1]) =>
    (h: H, writes: W, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const live = liveOf(h);

        // Before a policy, nobody is denounced and the public cap holds.
        const who = Option.match(live, {
          onNone: () => "unknown" as const,
          onSome: ({ policy }) => standing(policy, [], caller.handle),
        });

        const command = yield* Option.match(
          Option.fromUndefinedOr(input.discussion),
          {
            onNone: () =>
              Effect.succeed(
                DiscussionCommand.Open({
                  body: Option.fromUndefinedOr(input.body),
                  capped: capped(who),
                  denounced: who === "denounced",
                  id: DiscussionId.make(
                    minted("disc", discussionsNow(h, writes).length)
                  ),
                  openCount: openDiscussionsOf(h, writes, caller.handle),
                  project: name,
                  // The contract's filter makes a title certain here.
                  title: input.title ?? "",
                  who: caller,
                })
              ),
            onSome: (named) =>
              Effect.map(
                Effect.fromOption(
                  Array.findFirst(
                    discussionsNow(h, writes),
                    (each) => each.id === named
                  )
                ).pipe(
                  Effect.mapError(
                    () => new UnknownDiscussion({ discussion: named })
                  )
                ),
                (discussion) =>
                  DiscussionCommand.Reply({
                    // The contract's filter makes a body certain here.
                    body: input.body ?? "",
                    denounced: who === "denounced",
                    discussion,
                    who: caller,
                  })
              ),
          }
        );

        const { discussion, effects } = yield* Effect.fromResult(
          post(command, now)
        );

        writes.discussions.set(discussion.id, discussion);
        emitted(writes, effects);

        return { discussion };
      });

  const byLastPost = Order.mapInput(
    Order.flip(DateTime.Order),
    (listing: DiscussionListing) => listing.lastPostAt
  );

  const discussionsOf = Effect.map(kernel.read, (h) => ({
    discussions: Array.sort(h.discussions.map(discussionListingOf), byLastPost),
  }));

  const discussionOf = (discussion: DiscussionId) =>
    Effect.flatMap(kernel.read, (h) =>
      Option.match(
        Array.findFirst(h.discussions, ({ id }) => id === discussion),
        {
          onNone: () => Effect.fail(new UnknownDiscussion({ discussion })),
          onSome: (found) => Effect.succeed({ discussion: found }),
        }
      )
    );

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
              capped: capped(standing(policy, [], caller.handle)),
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

  const awaitingFinish = (h: H, ask: AskId) =>
    Array.findFirst(
      h.answers,
      ({ record, row }) =>
        row.ask === ask && LandingState.guards.AwaitingFinish(record.landing)
    );

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

        yield* settleDecided(h, writes, now, taken);

        return { decision: taken.decision };
      });

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

        // The maintainer as the policy spells them, as `decide` and Today do:
        // the credit names one person however they sign in.
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

  const carry = (
    input: {
      readonly env: UnlandedRunEnv;
      readonly lanes: readonly CheckLane[];
      readonly landings: AnswerQueue["landings"];
      readonly message: string;
      readonly now: DateTime.Utc;
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

      const reported = yield* runStep(run, next, input.landings);

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
    (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["land"]>[1]
    ) =>
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

        // Stages 0–1, minus the touched-judge refusal: a maintainer may change the judge where they decide.
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
              landings: queue.landings,
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

        return yield* new RepoBusy({});
      });

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

  const todayOf = (caller: Person) =>
    Effect.gen(function* () {
      const h = yield* kernel.read;
      const now = yield* DateTime.now;

      const decider = Option.flatMap(h.policy, (policy) =>
        asDecider(policy, caller.handle)
      );

      if (Option.isNone(decider)) {
        return yield* new NotDecider({});
      }

      return today({
        decider: decider.value,
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
    ) => kernel.write(queue, landBody(queue, caller, input)),
    listDiscussions: discussionsOf,
    postDiscussion: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["postDiscussion"]>[1]
    ) => kernel.write(queue, postBody(caller, input)),
    proposeAsk: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["proposeAsk"]>[1]
    ) => kernel.write(queue, proposeBody(caller, input)),
    showDiscussion: discussionOf,
    showProposal: proposalOf,
    today: todayOf,
    vouch: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["vouch"]>[1]
    ) => kernel.write(queue, vouchBody(caller, input)),
  };
};
