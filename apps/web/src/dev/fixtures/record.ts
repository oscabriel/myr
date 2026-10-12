import { creditsByArea } from "@repo/project/attention/credits";
import { today } from "@repo/project/attention/today";
import { listingOf } from "@repo/project/events";
import type { Verdict } from "@repo/protocol/domain/answer";
import {
  AnswerView,
  Verdict as VerdictSchema,
} from "@repo/protocol/domain/answer";
import { Ask } from "@repo/protocol/domain/ask";
import type { AskListing } from "@repo/protocol/domain/ask";
import { ClaimView } from "@repo/protocol/domain/claim";
import { ForkRef } from "@repo/protocol/domain/code";
import { ConfigFile } from "@repo/protocol/domain/common";
import { Decision } from "@repo/protocol/domain/decision";
import type { Choice, Today } from "@repo/protocol/domain/decision";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { LandingView } from "@repo/protocol/domain/landing";
import { Proposal } from "@repo/protocol/domain/proposal";
import type { CreditSummary } from "@repo/protocol/domain/record";
import { Ledger } from "@repo/protocol/domain/visibility";
import { sameHandle } from "@repo/protocol/ids";
import type {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  ProposalId,
} from "@repo/protocol/ids";
import {
  DecisionClosed,
  NotDecider,
  UnknownDecision,
} from "@repo/protocol/refusal";
import { Array, DateTime, Effect, Option, Schema } from "effect";

import { present } from "./story.ts";

export interface HeldProposal {
  readonly files: readonly ConfigFile[];
  readonly proposal: Proposal;
}

export interface KeptLog {
  readonly claimant: Handle;
  readonly lane: Verdict["lanes"][number]["lane"];
  readonly text: string;
}

export interface FixtureRecord {
  readonly answers: readonly AnswerView[];
  readonly asks: ReadonlyMap<AskId, Ask>;
  readonly claims: readonly ClaimView[];
  readonly decisions: readonly Decision[];
  readonly env: EnvSchemaView;
  readonly events: readonly ProjectEvent[];
  readonly firstClaims: readonly {
    readonly at: DateTime.Utc;
    readonly handle: Handle;
  }[];
  readonly forks: readonly ForkRef[];
  readonly head: LandedSha;
  readonly landings: readonly LandingView[];
  readonly ledger: Ledger;
  readonly logs: ReadonlyMap<string, KeptLog>;
  readonly proposals: ReadonlyMap<ProposalId, HeldProposal>;
  readonly verdicts: ReadonlyMap<AskId, readonly Verdict[]>;
}

const asType = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.toType(schema));

export const decodeRecord = (
  record: FixtureRecord
): Effect.Effect<FixtureRecord> =>
  Effect.gen(function* () {
    const many = <S extends Schema.Top>(
      schema: S,
      values: readonly unknown[]
    ) => asType(Schema.Array(schema))(values);

    yield* many(Ask, [...record.asks.values()]);
    yield* many(ProjectEvent, record.events);
    yield* many(VerdictSchema, [...record.verdicts.values()].flat());
    yield* many(AnswerView, record.answers);
    yield* many(LandingView, record.landings);
    yield* many(Decision, record.decisions);
    yield* many(ClaimView, record.claims);
    yield* many(ForkRef, record.forks);
    yield* many(
      Proposal,
      [...record.proposals.values()].map((held) => held.proposal)
    );
    yield* many(
      ConfigFile,
      [...record.proposals.values()].flatMap(({ files }) => files)
    );
    yield* asType(Ledger)(record.ledger);
    yield* asType(EnvSchemaView)(record.env);

    return record;
  }).pipe(Effect.orDie);

export const listedOf = (record: FixtureRecord): readonly AskListing[] =>
  [...record.asks.values()].flatMap((ask) =>
    ask.state === "closed" ? [] : [listingOf(ask)]
  );

export const verdictIn = (
  record: FixtureRecord,
  ask: AskId,
  head: CommitSha | undefined
): Option.Option<Verdict> => {
  const rounds = record.verdicts.get(ask) ?? [];

  return Array.findLast(
    rounds,
    (verdict) => head === undefined || verdict.head === head
  );
};

export const landingIn = (record: FixtureRecord, sha: CommitSha) =>
  Array.findFirst(record.landings, (landing) => landing.sha === sha);

const spentBy = (record: FixtureRecord, decider: Handle, now: DateTime.Utc) => {
  const day = DateTime.formatIsoDateUtc(now);

  return record.decisions.filter(
    ({ decided }) =>
      decided !== undefined &&
      sameHandle(decided.by, decider) &&
      DateTime.formatIsoDateUtc(decided.at) === day
  ).length;
};

export const todayIn = (
  record: FixtureRecord,
  decider: Handle,
  now: DateTime.Utc,
  perDay: number
): Option.Option<Today> =>
  record.decisions.some(({ deciders }) =>
    deciders.some((each) => sameHandle(each, decider))
  )
    ? Option.some(
        today({
          budget: {
            finishes: 0,
            total: perDay,
            used: spentBy(record, decider, now),
          },
          decider,
          decisions: record.decisions,
          firstClaims: record.firstClaims,
          landings: record.landings,
          now,
        })
      )
    : Option.none();

export const creditsIn = (
  record: FixtureRecord,
  handle: Handle
): readonly CreditSummary[] =>
  creditsByArea({ asks: record.asks, handle, landings: record.landings });

export const statusIn = (record: FixtureRecord, who: Handle) => ({
  answers: record.answers.filter(({ ask }) =>
    record.claims.some(
      (claim) => claim.ask === ask && sameHandle(claim.claimant, who)
    )
  ),
  claims: record.claims.filter(
    ({ claimant, state }) =>
      sameHandle(claimant, who) && (state === "live" || state === "warned")
  ),
});

export const decisionTaken = (
  record: FixtureRecord,
  input: {
    readonly choice: Choice;
    readonly decision: DecisionId;
    readonly note?: string;
    readonly now: DateTime.Utc;
    readonly who: Handle;
  }
): Effect.Effect<Decision, UnknownDecision | DecisionClosed | NotDecider> =>
  Effect.gen(function* () {
    const found = record.decisions.find(({ id }) => id === input.decision);

    if (found === undefined) {
      return yield* new UnknownDecision({ decision: input.decision });
    }

    if (
      found.decided !== undefined ||
      DateTime.isLessThanOrEqualTo(found.expiresAt, input.now)
    ) {
      return yield* new DecisionClosed({ decision: input.decision });
    }

    if (!found.deciders.some((each) => sameHandle(each, input.who))) {
      return yield* new NotDecider({});
    }

    return {
      ...found,
      decided: {
        at: input.now,
        by: input.who,
        choice: input.choice,
        ...present("note", input.note),
      },
    };
  });

export const lastSeqOf = (record: FixtureRecord): number =>
  Math.max(0, ...record.events.map(({ seq }) => seq));
