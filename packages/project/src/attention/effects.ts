/**
 * What attention asks of the project service. Proposals, decisions and Today
 * are pure: each move returns its next state and these effects as data, and
 * the service settles them after it persists the move (ADR 0012), the way it
 * settles a lifecycle's effects.
 */
import { Brand } from "@repo/brand";
import type { RefNameText } from "@repo/protocol/domain/common";
import type { DecisionSubject } from "@repo/protocol/domain/decision";
import { Handle } from "@repo/protocol/ids";
import type { CommitSha, ProposalId } from "@repo/protocol/ids";
import { Data } from "effect";
import type { DateTime } from "effect";

import type { ProjectEventInput } from "../events.ts";

/** What the project service does after a proposal or decision moved, in order. */
export type AttentionEffect = Data.TaggedEnum<{
  /** Tell the project's watchers. */
  Emit: { readonly event: ProjectEventInput };
  /** Let what a decider said yes to go ahead: a ratchet raised, a waiver, a vouch, a stray push adopted. */
  Land: { readonly subject: DecisionSubject };
  /** Write the accepted proposal's ask file and open it, red first, like any ask. */
  OpenAsk: { readonly proposal: ProposalId };
  /** Land a commit that puts `ref` back to `to`'s tree: a stray push undone, its commits kept in history. */
  Revert: { readonly ref: RefNameText; readonly to: CommitSha };
  SetAlarm: { readonly at: DateTime.Utc };
}>;

/** Constructors for attention's effects. */
export const AttentionEffect = Data.taggedEnum<AttentionEffect>();

/**
 * The platform's own handle: who `decided.by` names when nobody decided in
 * time and a decision took its default.
 */
export const platformHandle: Handle = Handle.make(Brand.slug);
