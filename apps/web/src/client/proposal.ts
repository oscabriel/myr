import type { DraftAsk } from "@repo/protocol/contracts";
import type { ProjectName, ProposalId } from "@repo/protocol/ids";
import { Effect } from "effect";
import { Atom, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const proposalAtom = Atom.family((project: ProjectName) =>
  Atom.family((proposal: ProposalId) =>
    Atom.withServerValueInitial(
      ContractsClient.query(
        "showProposal",
        { project, proposal },
        { reactivityKeys: keys.proposal(project, proposal) }
      )
    )
  )
);

export const projectTodayAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query(
      "today",
      { project },
      { reactivityKeys: [...keys.today(), ...keys.project(project)] }
    )
  )
);

// Reads again on `DraftInProgress` or `ProposalClosed` too, since then the page shows a stale state.
export const draftAtom = ContractsClient.runtime.fn<
  typeof DraftAsk.payloadSchema.Type
>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* ContractsClient;
    const changed = keys.proposal(input.project, input.proposal);

    return yield* client("draftAsk", input).pipe(
      Reactivity.mutation(changed),
      Effect.tapErrorTag(["DraftInProgress", "ProposalClosed"], () =>
        Reactivity.invalidate(changed)
      )
    );
  })
);
