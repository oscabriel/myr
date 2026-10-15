import { Schema } from "effect";

import {
  AskId,
  CommitSha,
  DecisionId,
  DiscussionId,
  Handle,
  LandedSha,
} from "../ids.ts";
import { AskListing } from "./ask.ts";
import { Choice } from "./decision.ts";
import { LandingView } from "./landing.ts";
import { Outcome } from "./outcome.ts";
import { LedgerEntry } from "./visibility.ts";

const stamp = { at: Schema.DateTimeUtcFromString, seq: Schema.Int };

export const ProjectEvent = Schema.TaggedUnion({
  AskClosed: { ...stamp, ask: AskId, landing: LandedSha },
  AskOpened: { ...stamp, ask: AskListing },
  Claimed: { ...stamp, ask: AskId, claimant: Handle },
  Decided: { ...stamp, choice: Choice, decision: DecisionId },
  DiscussionPosted: { ...stamp, by: Handle, discussion: DiscussionId },
  Judged: { ...stamp, ask: AskId, head: CommitSha, outcome: Outcome },
  Landed: { ...stamp, landing: LandingView },
  Lapsed: { ...stamp, ask: AskId },
  LedgerAppended: { ...stamp, entry: LedgerEntry },
  Pushed: { ...stamp, ask: AskId, head: CommitSha },
  Released: { ...stamp, ask: AskId },
  Warned: { ...stamp, ask: AskId },
});

export type ProjectEvent = typeof ProjectEvent.Type;
