import { Schema } from "effect";

import {
  AskId,
  CommitSha,
  DecisionId,
  EnvKey,
  Handle,
  ProjectName,
  ProposalId,
  RatchetName,
} from "../ids.ts";
import { Posture } from "../posture.ts";
import { At, Evidence, Hostname, RefNameText } from "./common.ts";
import { LandingView } from "./landing.ts";

/** What a decision is about. */
export const DecisionSubject = Schema.TaggedUnion({
  /** A passing answer a decider may finish before it lands. */
  Finish: { ask: AskId, head: CommitSha },
  /** Open the ask a proposal asks for. */
  OpenProposal: { proposal: ProposalId },
  /** Change the project's posture. */
  PostureChange: { from: Posture, to: Posture },
  /** Let an env item's placeholder be swapped on requests to more hosts. */
  ProxyWidened: { hosts: Schema.Array(Hostname), item: EnvKey },
  /** Raise a ratchet, which only a decider may do. */
  RaiseRatchet: {
    after: Schema.Int,
    ask: AskId,
    before: Schema.Int,
    ratchet: RatchetName,
    territory: Schema.NonEmptyString,
  },
  /** A write-only value showed up in an answer's tree; the answer is held aside. */
  SecretInTree: { ask: AskId, item: EnvKey },
  /** A canonical ref moved without a landing: adopt it or revert it. */
  StrayPush: { after: CommitSha, before: CommitSha, ref: RefNameText },
  /** Admit a person by a line in the vouch file. */
  Vouch: { handle: Handle },
  /** Allow one weakening marker, with its reason. */
  Waiver: {
    ask: AskId,
    at: At,
    marker: Schema.NonEmptyString,
    reason: Schema.NonEmptyString,
  },
});

export type DecisionSubject = typeof DecisionSubject.Type;

/** What a decider chooses. */
export const Choice = Schema.Literals(["accept", "decline", "adopt", "revert"]);

export type Choice = typeof Choice.Type;

/**
 * A decision: one choice for a project's deciders, with its evidence and a
 * safe default that is taken when it expires.
 */
export const Decision = Schema.Struct({
  decided: Schema.optionalKey(
    Schema.Struct({
      at: Schema.DateTimeUtcFromString,
      by: Handle,
      choice: Choice,
      note: Schema.optionalKey(Schema.String),
    })
  ),
  deciders: Schema.NonEmptyArray(Handle),
  /** What happens when it expires undecided. */
  default: Choice,
  evidence: Schema.Array(Evidence),
  expiresAt: Schema.DateTimeUtcFromString,
  id: DecisionId,
  openedAt: Schema.DateTimeUtcFromString,
  project: ProjectName,
  subject: DecisionSubject,
});

export type Decision = typeof Decision.Type;

/**
 * Today: a decider's daily page of decisions with evidence and safe defaults,
 * held to their budget. What doesn't fit waits, and may expire.
 */
export const Today = Schema.Struct({
  budget: Schema.Struct({
    finishes: Schema.Int,
    total: Schema.Int,
    used: Schema.Int,
  }),
  decider: Handle,
  /** In order of expiry, as many as the budget allows. */
  decisions: Schema.Array(Decision),
  expiringSoon: Schema.Array(DecisionId),
  /** People who made their first claim this week, to welcome. */
  newcomers: Schema.Array(Handle),
  /** How many decisions wait beyond the budget. */
  overflow: Schema.Int,
  /** A sample of landings that needed no decision. */
  unattended: Schema.Array(LandingView),
});

export type Today = typeof Today.Type;
