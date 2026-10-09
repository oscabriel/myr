/**
 * A proposal's reads and its one write. `proposalAtom` reads `showProposal`
 * (its draft's state and the files it holds), keyed by `keys.proposal`,
 * which a `ProposalDrafted` event invalidates (`watch.ts`), so the page
 * follows a draft from Drafting to Ready or Failed. `draftAtom` is the
 * proposer's or a decider's "Draft again" over `draftAsk`.
 *
 * The decider's Today in one project lives here too, as the proposal page
 * reads it: it holds the open decision on the proposal (within the day's
 * budget), and it answers only a decider (`NotDecider` otherwise); it reads
 * again when the project's keys change, as a settled draft changes them. Each read
 * renders as waiting on the server, so the Worker reads none of them for a
 * page that draws them in the browser.
 */
import type { DraftAsk } from "@repo/protocol/contracts";
import type { ProjectName, ProposalId } from "@repo/protocol/ids";
import { Effect } from "effect";
import { Atom, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** One proposal and the files it holds: `proposalAtom(project)(proposal)`. */
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

/**
 * The reader's Today in `project`, when they decide there. A draft that
 * settles puts its decision up, so the project's keys (which a
 * `ProposalDrafted` changes, through `keys.proposal`) read it again too.
 */
export const projectTodayAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query(
      "today",
      { project },
      { reactivityKeys: [...keys.today(), ...keys.project(project)] }
    )
  )
);

/**
 * Draft a proposal's ask again: `{ project, proposal, note? }`, answered
 * with the proposal as it now stands (Drafting). The proposal reads again
 * on success, and on `DraftInProgress` or `ProposalClosed` too, since then
 * the page shows a stale state.
 */
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
