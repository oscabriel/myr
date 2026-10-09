/**
 * Where a proposal's draft stands, read live for a view that is not handed
 * it: the decision card on Today holds Accept while the platform's agent
 * drafts the proposal again. The read is `showProposal` (`client/proposal.ts`),
 * which `ProposalDrafted` refreshes; on the server, and until it answers,
 * the draft is unknown (`Option.none`).
 */
import { useAtomValue } from "@effect/atom-react";
import type { DraftState } from "@repo/protocol/domain/proposal";
import type { ProjectName, ProposalId } from "@repo/protocol/ids";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { proposalAtom } from "../../client/proposal.ts";

export const useLiveDraft = (
  project: ProjectName,
  proposal: ProposalId
): Option.Option<DraftState> =>
  Option.flatMap(
    AsyncResult.value(useAtomValue(proposalAtom(project)(proposal))),
    (shown) => Option.fromUndefinedOr(shown.proposal.draft)
  );
