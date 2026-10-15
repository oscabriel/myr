import { RefName, RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { CheckRunner } from "@repo/checks/check-runner";
import type { PushFacts } from "@repo/gate/facts";
import { pushStages, runGate } from "@repo/gate/gate";
import { scan } from "@repo/gate/stages/shape";
import { formatLanding } from "@repo/git/trailers";
import type { AnswerReceipt, LandReceipt } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { RefNameText } from "@repo/protocol/domain/common";
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
import type { CreditSummary } from "@repo/protocol/domain/record";
import type { Ledger } from "@repo/protocol/domain/visibility";
import {
  CommitSha,
  DecisionId,
  DiscussionId,
  LandedSha,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
  keyOf,
  sameHandle,
} from "@repo/protocol/ids";
import type { AskId, ProjectName, Handle, EnvKey } from "@repo/protocol/ids";
import type { Person, Principal } from "@repo/protocol/principal";
import {
  Denounced,
  NotDecider,
  NotVouched,
  StaleBase,
  TouchedJudge,
  UnknownDiscussion,
} from "@repo/protocol/refusal";
import type {
  CapReached,
  DecisionClosed,
  DiscussionClosed,
  IncompleteBrief,
  NotRedFirst,
  NotSensitive,
  Refusal,
  UnknownDecision,
  UnknownEnvItem,
  UnknownProject,
  ValueTooShort,
  VerifierBlocked,
  WeakCheck,
  RepoBusy,
} from "@repo/protocol/refusal";
import { parseVouchFile } from "@repo/rules/vouch";
import { Array, DateTime, Effect, Match, Option, Order, Schema } from "effect";
import type { Redacted } from "effect";

import type { Advanced, AnswerQueue } from "./answer-runs.ts";
import { creditsByArea } from "./attention/credits.ts";
import {
  decide,
  decidersFor,
  expireDecisions,
  openDecision,
} from "./attention/decisions.ts";
import type { Decided } from "./attention/decisions.ts";
import { DiscussionCommand, post } from "./attention/discussions.ts";
import { AttentionEffect, platformHandle } from "./attention/effects.ts";
import { today } from "./attention/today.ts";
import { capped, standing } from "./attention/vouch.ts";
import { ClaimState } from "./claim.ts";
import { ProjectEventInput } from "./events.ts";
import { pushFacts } from "./facts.ts";
import { Lander, Rebuild } from "./lander.ts";
import type { ComposedFile } from "./lander.ts";
import {
  AnswerDecision,
  LandingCommand,
  LandingState,
  outcomeOf,
} from "./landing.ts";
import type { Request } from "./landing.ts";
import { OutboxBody, outboxRow, startRow } from "./outbox.ts";
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
  readonly showDiscussion: (
    caller: Principal,
    discussion: DiscussionId
  ) => Effect.Effect<{ readonly discussion: Discussion }, UnknownDiscussion>;
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
}

export interface DeciderWrites {
  readonly decisions: Map<DecisionId, Decision>;
  readonly discussions: Map<DiscussionId, Discussion>;
  readonly events: ProjectEventInput[];
  readonly landings: LandingView[];
  readonly outbox: OutboxRow[];
  readonly project: Map<"row", ProjectRow>;
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
  readonly enqueueLand: (
    writes: W,
    request: Request,
    input: {
      readonly main: LandedSha;
      readonly message: string;
      readonly now: DateTime.Utc;
    }
  ) => Effect.Effect<LandReceipt>;
  readonly name: ProjectName;
  readonly policyAt: (
    row: ProjectRow,
    at: LandedSha,
    now: DateTime.Utc
  ) => Effect.Effect<ProjectRow>;
  readonly read: Effect.Effect<H>;
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

export const deciderDeadlines = (h: DeciderState): readonly DateTime.Utc[] =>
  h.decisions.flatMap(({ decided, expiresAt }) =>
    decided === undefined ? [expiresAt] : []
  );

const unlanded = (handle: Handle, refused: NotDecider | StaleBase) =>
  Effect.logWarning(`the vouch for ${handle} did not land`, refused);

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

  const goAhead = (
    h: H,
    writes: W,
    now: DateTime.Utc,
    input: { readonly by: Handle; readonly subject: DecisionSubject }
  ): Effect.Effect<void> =>
    DecisionSubject.match(input.subject, {
      Finish: ({ ask, head }) =>
        finishAt(h, writes, now, { ask, by: input.by, head }),
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
            Revert: () =>
              DecisionSubject.guards.StrayPush(decision.subject)
                ? revert(h, writes, now, { by, stray: decision.subject })
                : Effect.void,
            // The alarm is set once settled, to the earliest deadline of all.
            SetAlarm: () => Effect.void,
          }),
        { discard: true }
      );

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

        // The same request again: the landing it made, or its run as it stands.
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

        const queued = Array.findFirst(
          h.answers,
          ({ row }) => row.requestId === input.requestId
        );

        if (Option.isSome(queued)) {
          const { record, row } = queued.value;

          // An answer's request id, or another maintainer's, is not this landing's to read.
          return row.ask === undefined &&
            sameHandle(row.answerer, caller.handle)
            ? receiptOf(outcomeOf(record.landing))
            : yield* new NotDecider({});
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

        // The checks run after this call returns, as an answer's do: a send
        // of the same request reads where they stand, and the landing's own
        // receipt once it lands.
        return yield* kernel.enqueueLand(
          writes,
          {
            answerer: caller.handle,
            ask: Option.none(),
            assisted: [],
            base: input.base,
            credits,
            fork,
            head: input.head,
            project: name,
            requestId: input.requestId,
          },
          {
            main,
            message: formatLanding({
              assisted: [],
              credits,
              requestId: input.requestId,
              ...messageParts(input.message),
            }),
            now,
          }
        );
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
    expire,
    finish: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["finish"]>[1]
    ) => kernel.write(queue, finishBody(caller, input)),
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
    showDiscussion: discussionOf,
    today: todayOf,
    vouch: (
      queue: AnswerQueue,
      caller: Person,
      input: Parameters<DeciderApi["vouch"]>[1]
    ) => kernel.write(queue, vouchBody(caller, input)),
  };
};
