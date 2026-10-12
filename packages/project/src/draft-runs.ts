import { AtLeastOne, ConfigFile } from "@repo/protocol/domain/common";
import { PublicPolicy } from "@repo/protocol/domain/policy";
import {
  LandedSha,
  LaneName,
  ProjectName,
  ProposalId,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import { Context, Effect, Schema } from "effect";

export const DRAFT_ROUNDS = 3;

export const EXCERPT_BYTES = 4 * 1024;

/** The note travels with the run, since a proposal keeps no note of its own. */
export const DraftParams = Schema.Struct({
  note: Schema.optionalKey(Schema.String),
  project: ProjectName,
  proposal: ProposalId,
  round: AtLeastOne,
});

export type DraftParams = typeof DraftParams.Type;

export interface DraftStarter {
  /** Safe to call twice. */
  readonly start: (params: DraftParams) => Effect.Effect<void>;
}

export const DraftRuns = Context.Reference<DraftStarter>("project/DraftRuns", {
  defaultValue: () => ({ start: () => Effect.void }),
});

export const Diagnosis = Schema.Literals([
  "LoadError",
  "Passed",
  "NoTests",
  "Flaky",
  "Blocked",
  "Weak",
  "Brief",
  "Judge",
]);

export type Diagnosis = typeof Diagnosis.Type;

export const Rehearsal = Schema.TaggedUnion({
  Red: {
    lane: LaneName,
    signature: Schema.NonEmptyString,
    tree: TreeSha,
  },
  Refused: {
    diagnosis: Diagnosis,
    excerpt: Schema.String,
    refusal: Refusal,
  },
});

export type Rehearsal = typeof Rehearsal.Type;

const attempt = {
  attempts: AtLeastOne.check(Schema.isLessThanOrEqualTo(DRAFT_ROUNDS)),
  model: Schema.NonEmptyString,
};

export const DraftResult = Schema.TaggedUnion({
  Failed: { ...attempt, refusal: Refusal },
  Red: {
    ...attempt,
    files: Schema.NonEmptyArray(ConfigFile),
    lane: LaneName,
    rationale: Schema.String,
    signature: Schema.NonEmptyString,
  },
});

export type DraftResult = typeof DraftResult.Type;

/** Carries the public policy only, never `visibility`. */
export const DraftContextData = Schema.Struct({
  at: LandedSha,
  paths: Schema.Array(RepoPath),
  policy: PublicPolicy,
  project: ProjectName,
  proposal: ProposalId,
  round: AtLeastOne,
  territory: Schema.optionalKey(Schema.NonEmptyString),
  want: Schema.NonEmptyString,
});

export type DraftContextData = typeof DraftContextData.Type;
