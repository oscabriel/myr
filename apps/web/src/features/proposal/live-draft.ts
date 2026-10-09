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
import { Data, Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { proposalAtom } from "../../client/proposal.ts";

/**
 * What the browser has read of a proposal's draft: nothing (`Unread`), yet
 * or because the read `failed`; or the draft it read, `None` for a
 * proposal no agent drafted (a want alone).
 */
export type DraftRead = Data.TaggedEnum<{
  Read: { readonly draft: Option.Option<DraftState> };
  Unread: { readonly failed: boolean };
}>;

/** Constructors and guards for a draft read. */
export const DraftRead = Data.taggedEnum<DraftRead>();

/** A draft read: `draft`, or none for a proposal no agent drafted. */
export const readDraft = (draft?: DraftState): DraftRead =>
  DraftRead.Read({ draft: Option.fromUndefinedOr(draft) });

/** The draft a `showProposal` read holds: once it answered, or why there is none yet. */
export const draftReadOf = (
  result: AsyncResult.AsyncResult<
    typeof ShowProposal.successSchema.Type,
    unknown
  >
): DraftRead =>
  Option.match(AsyncResult.value(result), {
    onNone: () => DraftRead.Unread({ failed: AsyncResult.isFailure(result) }),
    onSome: (shown) => readDraft(shown.proposal.draft),
  });

export const useLiveDraft = (
  project: ProjectName,
  proposal: ProposalId
): DraftRead => draftReadOf(useAtomValue(proposalAtom(project)(proposal)));
