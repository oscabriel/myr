/**
 * Where a proposal's draft stands, read live for a view that is not handed
 * it: the decision card on Today holds Accept until the browser has read the
 * proposal's draft, and while the platform's agent drafts it again. The read
 * is `showProposal` (`client/proposal.ts`), which `ProposalDrafted`
 * refreshes; on the server, and until it answers, nothing is read yet.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ShowProposal } from "@repo/protocol/contracts";
import type { DraftState } from "@repo/protocol/domain/proposal";
import type { ProjectName, ProposalId } from "@repo/protocol/ids";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { proposalAtom } from "../../client/proposal.ts";

/**
 * What the browser has read of a proposal's draft: `None` until it has
 * read it; then the draft it read, `None` within for a proposal no agent
 * drafted (a want alone).
 */
export type DraftRead = Option.Option<Option.Option<DraftState>>;

/** A draft read: `draft`, or none for a proposal no agent drafted. */
export const readDraft = (draft?: DraftState): DraftRead =>
  Option.some(Option.fromUndefinedOr(draft));

/** The draft a `showProposal` read holds, once it answered. */
export const draftReadOf = (
  result: AsyncResult.AsyncResult<
    typeof ShowProposal.successSchema.Type,
    unknown
  >
): DraftRead =>
  Option.map(AsyncResult.value(result), (shown) =>
    Option.fromUndefinedOr(shown.proposal.draft)
  );

export const useLiveDraft = (
  project: ProjectName,
  proposal: ProposalId
): DraftRead => draftReadOf(useAtomValue(proposalAtom(project)(proposal)));
