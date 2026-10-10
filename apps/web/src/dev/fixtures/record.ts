/**
 * A fixture project's record: everything its reads answer with, held as
 * one value so every contract reads the same story (the asks, the events
 * `watch` replays, the verdicts, the landings, the decisions, the ledger,
 * the env shape, the proposals and the claims). Every part is decoded
 * through the protocol's own schema before the world serves it
 * (`decodeRecord`), so a fixture cannot drift from the wire.
 *
 * The reads a record answers are derived here by the service's own pure
 * functions where it has them: Today by `today` (budget, overflow, what
 * expires within the day, newcomers, what landed without anyone), credits
 * by `creditsByArea`, a listing by `listingOf`.
 */
import { creditsByArea } from "@repo/project/attention/credits";
import { today } from "@repo/project/attention/today";
import { listingOf } from "@repo/project/events";
import type { AnswerView, Verdict } from "@repo/protocol/domain/answer";
import { Verdict as VerdictSchema } from "@repo/protocol/domain/answer";
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

/** One proposal and the files it holds. */
export interface HeldProposal {
  readonly files: readonly ConfigFile[];
  readonly proposal: Proposal;
}

/** A log a failing lane left, as `evidence` reads it back. */
export interface KeptLog {
  readonly claimant: Handle;
  readonly lane: Verdict["lanes"][number]["lane"];
  readonly text: string;
}

/** A fixture project's whole record. */
export interface FixtureRecord {
  /** Every claim's answers: one per round, oldest first. */
  readonly answers: readonly AnswerView[];
  readonly asks: ReadonlyMap<AskId, Ask>;
  /** Every claim, as its claimant's `status` shows it. */
  readonly claims: readonly ClaimView[];
  readonly decisions: readonly Decision[];
  readonly env: EnvSchemaView;
  readonly events: readonly ProjectEvent[];
  /** Each person's first claim, older history included. */
  readonly firstClaims: readonly {
    readonly at: DateTime.Utc;
    readonly handle: Handle;
  }[];
  readonly forks: readonly ForkRef[];
  /** Main's landed commit. */
  readonly head: LandedSha;
  readonly landings: readonly LandingView[];
  readonly ledger: Ledger;
  readonly logs: ReadonlyMap<string, KeptLog>;
  readonly proposals: ReadonlyMap<ProposalId, HeldProposal>;
  /** Each answered ask's verdicts, one per round, oldest first. */
  readonly verdicts: ReadonlyMap<AskId, readonly Verdict[]>;
}

const asType = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.toType(schema));

/**
 * `record` decoded part by part through the protocol's schemas: a value
 * that fails is a defect of the fixture's, found when the world is built.
 */
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

// ------------------------------------------------------------ reads

/** The open asks, as `listAsks` lists them. */
export const listedOf = (record: FixtureRecord): readonly AskListing[] =>
  [...record.asks.values()].flatMap((ask) =>
    ask.state === "closed" ? [] : [listingOf(ask)]
  );

/** The verdict on `head`, or the latest; its outcome where the answer stands now. */
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

/** The landing at `sha`, if the record holds one. */
export const landingIn = (record: FixtureRecord, sha: CommitSha) =>
  Array.findFirst(record.landings, (landing) => landing.sha === sha);

/** How many decisions and finishes `decider` took on the day of `now`. */
const spentBy = (record: FixtureRecord, decider: Handle, now: DateTime.Utc) => {
  const day = DateTime.formatIsoDateUtc(now);

  return record.decisions.filter(
    ({ decided }) =>
      decided !== undefined &&
      sameHandle(decided.by, decider) &&
      DateTime.formatIsoDateUtc(decided.at) === day
  ).length;
};

/** `decider`'s Today in the record, as the service computes one; none for anyone who decides nothing in it. */
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

/** A person's credits in the record, by area and role. */
export const creditsIn = (
  record: FixtureRecord,
  handle: Handle
): readonly CreditSummary[] =>
  creditsByArea({ asks: record.asks, handle, landings: record.landings });

/** The caller's claims still in play, and their answers. */
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

/**
 * The decision `who` takes when they choose `choice` on `id` at `now`, with
 * its record (by, choice, when, note); or why they may not: no such
 * decision, one already taken or expired, or one they do not decide.
 */
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

/** The number of the record's last event. */
export const lastSeqOf = (record: FixtureRecord): number =>
  Math.max(0, ...record.events.map(({ seq }) => seq));
