import { DraftParams as DraftRun } from "@repo/project/draft-runs";
import {
  CommitSha,
  keyOf,
  LayerName,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { Schema } from "effect";

export const AnswerParams = Schema.Struct({
  project: ProjectName,
  requestId: RequestId,
});

export type AnswerParams = typeof AnswerParams.Type;

export const AdmissionParams = Schema.TaggedStruct("Admission", {
  head: CommitSha,
  layer: LayerName,
  project: ProjectName,
});

export type AdmissionParams = typeof AdmissionParams.Type;

export const DraftParams = Schema.TaggedStruct("Draft", DraftRun.fields);

export type DraftParams = typeof DraftParams.Type;

export const WorkflowParams = Schema.Union([
  AdmissionParams,
  DraftParams,
  AnswerParams,
]);

export type WorkflowParams = typeof WorkflowParams.Type;

const ID_LENGTH = 100;

// 2^31 - 1, so every step stays a safe integer.
const TAG_MODULUS = 2_147_483_647;

const tagOf = (text: string) => {
  let hash = 0;

  for (const unit of text) {
    hash = (hash * 31 + (unit.codePointAt(0) ?? 0)) % TAG_MODULUS;
  }

  return hash.toString(36);
};

// A name too long is cut and tagged with a hash of the whole name, so no two runs share an instance.
const instanceId = (named: string, suffix: string) => {
  const whole = `${named}${suffix}`;

  if (whole.length <= ID_LENGTH) {
    return whole;
  }

  const tag = `-${tagOf(named)}`;

  return `${named.slice(0, ID_LENGTH - tag.length - suffix.length)}${tag}${suffix}`;
};

export const admissionId = (params: AdmissionParams) =>
  instanceId(
    `admit-${keyOf(params.project)}-${params.layer}`,
    `-${params.head}`
  );

export const draftId = (
  params: Pick<DraftParams, "project" | "proposal" | "round">
) =>
  instanceId(
    `draft-${keyOf(params.project)}`,
    `-${params.proposal}-r${params.round}`
  );
