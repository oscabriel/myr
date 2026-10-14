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

export const DecisionSubject = Schema.TaggedUnion({
  Finish: { ask: AskId, head: CommitSha },
  OpenProposal: { proposal: ProposalId },
  PostureChange: { from: Posture, to: Posture },
  ProxyWidened: { hosts: Schema.Array(Hostname), item: EnvKey },
  RaiseRatchet: {
    after: Schema.Int,
    ask: AskId,
    before: Schema.Int,
    ratchet: RatchetName,
    territory: Schema.NonEmptyString,
  },
  SecretInTree: { ask: AskId, item: EnvKey },
  StrayPush: { after: CommitSha, before: CommitSha, ref: RefNameText },
  Vouch: { handle: Handle },
  Waiver: {
    ask: AskId,
    at: At,
    marker: Schema.NonEmptyString,
    reason: Schema.NonEmptyString,
  },
});

export type DecisionSubject = typeof DecisionSubject.Type;

export const Choice = Schema.Literals(["accept", "decline", "adopt", "revert"]);

export type Choice = typeof Choice.Type;

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
  default: Choice,
  evidence: Schema.Array(Evidence),
  expiresAt: Schema.DateTimeUtcFromString,
  id: DecisionId,
  openedAt: Schema.DateTimeUtcFromString,
  project: ProjectName,
  subject: DecisionSubject,
});

export type Decision = typeof Decision.Type;

/** A decider's open decisions, every one, ordered by expiry. */
export const Today = Schema.Struct({
  decider: Handle,
  decisions: Schema.Array(Decision),
  expiringSoon: Schema.Array(DecisionId),
  newcomers: Schema.Array(Handle),
  unattended: Schema.Array(LandingView),
});

export type Today = typeof Today.Type;
