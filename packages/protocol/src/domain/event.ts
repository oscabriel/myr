import { Schema } from "effect";

import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  ProposalId,
} from "../ids.ts";
import { AskListing } from "./ask.ts";
import { Choice } from "./decision.ts";
import { LandingView } from "./landing.ts";
import { Outcome } from "./outcome.ts";
import { LedgerEntry } from "./visibility.ts";

// Every event carries its time and its place in the project's sequence, so a
// watcher can resume after the last one it saw.
const stamp = { at: Schema.DateTimeUtcFromString, seq: Schema.Int };

/** One thing that happened in a project, as a watcher of it hears. */
export const ProjectEvent = Schema.TaggedUnion({
  AskClosed: { ...stamp, ask: AskId, landing: LandedSha },
  AskOpened: { ...stamp, ask: AskListing },
  Claimed: { ...stamp, ask: AskId, claimant: Handle },
  Decided: { ...stamp, choice: Choice, decision: DecisionId },
  /** An answer was checked. */
  Judged: { ...stamp, ask: AskId, head: CommitSha, outcome: Outcome },
  Landed: { ...stamp, landing: LandingView },
  /** A claim lapsed: no push for too long. */
  Lapsed: { ...stamp, ask: AskId },
  LedgerAppended: { ...stamp, entry: LedgerEntry },
  /** A proposal's draft settled: ready for a decider, or failed. */
  ProposalDrafted: { ...stamp, proposal: ProposalId, ready: Schema.Boolean },
  ProposalOpened: { ...stamp, proposal: ProposalId },
  Pushed: { ...stamp, ask: AskId, head: CommitSha },
  /** A claim was released. */
  Released: { ...stamp, ask: AskId },
  /** A claim was warned that it lapses without a push. */
  Warned: { ...stamp, ask: AskId },
});

export type ProjectEvent = typeof ProjectEvent.Type;
