import type { DiscussionId, ProjectName } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

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
