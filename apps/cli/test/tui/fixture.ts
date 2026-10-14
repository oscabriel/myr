import { RefNameText } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import {
  CommitSha,
  DecisionId,
  Handle,
  ProjectName,
  ProposalId,
} from "@repo/protocol/ids";
import { DateTime } from "effect";

const at = (iso: string) => DateTime.makeUnsafe(iso);

const sha = (digit: string) => CommitSha.make(digit.repeat(40));

export const okonkwo = Handle.make("okonkwo");

export const datekit = ProjectName.make("oscabriel/datekit");

/** An ask proposed for datekit, expiring tomorrow: last in expiry order. */
export const proposal: Decision = {
  deciders: [okonkwo],
  default: "accept",
  evidence: [{ label: "territory", value: "src/week" }],
  expiresAt: at("2026-10-09T09:00:00Z"),
  id: DecisionId.make("dec-000001"),
  openedAt: at("2026-10-07T09:00:00Z"),
  project: datekit,
  subject: DecisionSubject.cases.OpenProposal.make({
    proposal: ProposalId.make("prop-000001"),
  }),
};

/** A stray push to datekit's main, expiring within the day: first. */
export const stray: Decision = {
  deciders: [okonkwo],
  default: "revert",
  evidence: [{ label: "pushed by", value: "a token outside the platform" }],
  expiresAt: at("2026-10-08T10:00:00Z"),
  id: DecisionId.make("dec-000002"),
  openedAt: at("2026-10-06T10:00:00Z"),
  project: datekit,
  subject: DecisionSubject.cases.StrayPush.make({
    after: sha("b"),
    before: sha("a"),
    ref: RefNameText.make("refs/heads/main"),
  }),
};

/** A vouch for a newcomer, expiring this evening: second. */
export const vouch: Decision = {
  deciders: [okonkwo],
  default: "decline",
  evidence: [{ label: "first claim", value: "fix-week" }],
  expiresAt: at("2026-10-08T18:00:00Z"),
  id: DecisionId.make("dec-000003"),
  openedAt: at("2026-10-07T18:00:00Z"),
  project: datekit,
  subject: DecisionSubject.cases.Vouch.make({ handle: Handle.make("ada") }),
};

export const today: Today = {
  decider: okonkwo,
  decisions: [proposal, vouch, stray],
  expiringSoon: [stray.id],
  newcomers: [Handle.make("ada"), Handle.make("grace")],
  unattended: [],
};
