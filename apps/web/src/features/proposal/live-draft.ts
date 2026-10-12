import { useAtomValue } from "@effect/atom-react";
import type { ShowProposal } from "@repo/protocol/contracts";
import type { DraftState } from "@repo/protocol/domain/proposal";
import type { ProjectName, ProposalId } from "@repo/protocol/ids";
import { Data, Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { proposalAtom } from "../../client/proposal.ts";

export type DraftRead = Data.TaggedEnum<{
  Read: { readonly draft: Option.Option<DraftState> };
  Unread: { readonly failed: boolean };
}>;

export const DraftRead = Data.taggedEnum<DraftRead>();

export const readDraft = (draft?: DraftState): DraftRead =>
  DraftRead.Read({ draft: Option.fromUndefinedOr(draft) });

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
