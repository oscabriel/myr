/**
 * What a repo's name says it is, from `@repo/project/repo-names`, where
 * the project service lists its forks by it too: the gateway, the handlers
 * and OnPush read names from here.
 */
export {
  claimForkName,
  repoKind,
  RepoKind,
  workingForkName,
} from "@repo/project/repo-names";
