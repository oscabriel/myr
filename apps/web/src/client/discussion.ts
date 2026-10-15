import type { PostDiscussion } from "@repo/protocol/contracts";
import type { DiscussionId, ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";
import { Atom, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const discussionsAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query(
      "listDiscussions",
      { project },
      { reactivityKeys: keys.discussions(project) }
    )
  )
);

export const discussionAtom = Atom.family((project: ProjectName) =>
  Atom.family((discussion: DiscussionId) =>
    Atom.withServerValueInitial(
      ContractsClient.query(
        "showDiscussion",
        { discussion, project },
        { reactivityKeys: keys.discussion(project, discussion) }
      )
    )
  )
);

/** A reply refetches its thread and the list; a new thread, the list. */
export const postDiscussionAtom = ContractsClient.runtime.fn<
  typeof PostDiscussion.payloadSchema.Type
>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* ContractsClient;

    return yield* client("postDiscussion", input).pipe(
      Reactivity.mutation(
        input.discussion === undefined
          ? keys.discussions(input.project)
          : keys.discussion(input.project, input.discussion)
      )
    );
  })
);
