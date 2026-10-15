// Each key is one string: Reactivity treats every element of a key list as a key of its own.
import type { AskId, DiscussionId, ProjectName } from "@repo/protocol/ids";

export const keys = {
  ask: (project: ProjectName, ask: AskId): readonly string[] => [
    `ask:${project}/${ask}`,
    `project:${project}`,
  ],
  code: (project: ProjectName): readonly string[] => [`code:${project}`],
  discussion: (
    project: ProjectName,
    discussion: DiscussionId
  ): readonly string[] => [
    `discussion:${project}/${discussion}`,
    `discussions:${project}`,
  ],
  discussions: (project: ProjectName): readonly string[] => [
    `discussions:${project}`,
  ],
  // Not the project's key, so a page's reads can refetch without replaying every event.
  events: (project: ProjectName): readonly string[] => [`events:${project}`],
  front: (): readonly string[] => ["front"],
  ledger: (project: ProjectName): readonly string[] => [`ledger:${project}`],
  policy: (project: ProjectName): readonly string[] => [`policy:${project}`],
  project: (project: ProjectName): readonly string[] => [`project:${project}`],
  today: (): readonly string[] => ["today"],
};
