/**
 * The package's `./protocol` export: types only, for a maintainer's config
 * folder that names the data its rules evaluate to (the policy, its asks,
 * kinds, checks and territories) and the ids inside it.
 */
export type {
  AreaName,
  AskId,
  Handle,
  KindName,
  LandedSha,
  LaneName,
  RatchetName,
  RepoPath,
} from "@repo/protocol/ids";

export type { Ask, AskState, Brief } from "@repo/protocol/domain/ask";

export type {
  CheckSpec,
  RatchetMeasure,
  RatchetSpec,
  Strength,
} from "@repo/protocol/domain/check";

export type { Glob } from "@repo/protocol/domain/common";

export type {
  AskKind,
  BriefField,
  CheckKind,
  ClaimRule,
} from "@repo/protocol/domain/kind";

export type {
  AskInput,
  FromCI,
  Policy,
  PolicyInput,
} from "@repo/protocol/domain/policy";

export type { RunBlock } from "@repo/protocol/domain/run";

export type { Territory } from "@repo/protocol/domain/territory";
