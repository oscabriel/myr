/**
 * What starts the `Answer` Workflow. For one answer request: the port that
 * starts it is the project service's `AnswerRuns`
 * (`@repo/project/answer-runs`); the Project Durable Object implements it with
 * its project bound, and the Workflow decodes these params. The instance id is
 * the request id, so a second start of one request changes nothing.
 *
 * For the admission of a layer push's sealed checks:
 * admission runs as steps of the same Workflow under its own tagged
 * params, so typed visibility adds no Workflow binding. Its instance id is
 * `admissionId`, so a push admitted twice runs once.
 *
 * For one round of a proposal's draft: the run (`@repo/drafting/run`) is
 * steps of the same Workflow under params tagged `Draft`, so drafting adds
 * no Workflow binding (ADR 0018). Its instance id is `draftId`, one per
 * project, proposal and round, so a round started twice runs once.
 */
import { DraftParams as DraftRun } from "@repo/project/draft-runs";
import {
  CommitSha,
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

/** An admission of the head pushed to one of a project's layers. */
export const AdmissionParams = Schema.TaggedStruct("Admission", {
  head: CommitSha,
  layer: LayerName,
  project: ProjectName,
});

export type AdmissionParams = typeof AdmissionParams.Type;

/**
 * One round of a proposal's draft: its project, proposal and round, and the
 * note the round was asked with, which travels with the run.
 */
export const DraftParams = Schema.TaggedStruct("Draft", DraftRun.fields);

export type DraftParams = typeof DraftParams.Type;

/** Every run the `Answer` Workflow takes: an admission's, a draft's, or an answer's. */
export const WorkflowParams = Schema.Union([
  AdmissionParams,
  DraftParams,
  AnswerParams,
]);

export type WorkflowParams = typeof WorkflowParams.Type;

/** How long a Workflow instance id may be. */
const ID_LENGTH = 100;

/** A modulus for `tagOf`: the Mersenne prime 2^31 - 1, so every step stays a safe integer. */
const TAG_MODULUS = 2_147_483_647;

/** A polynomial hash of `text`'s code points, in base 36: a short, stable tag for a name cut short. */
const tagOf = (text: string) => {
  let hash = 0;

  for (const unit of text) {
    hash = (hash * 31 + (unit.codePointAt(0) ?? 0)) % TAG_MODULUS;
  }

  return hash.toString(36);
};

/**
 * An instance id of `named` then `suffix`, within the engine's length. The
 * suffix is kept whole; a name too long is cut and tagged with a hash of the
 * whole name, so two runs with different suffixes or names never share an
 * instance (one that exists is never started again).
 */
const instanceId = (named: string, suffix: string) => {
  const whole = `${named}${suffix}`;

  if (whole.length <= ID_LENGTH) {
    return whole;
  }

  const tag = `-${tagOf(named)}`;

  return `${named.slice(0, ID_LENGTH - tag.length - suffix.length)}${tag}${suffix}`;
};

/** The instance an admission runs as: one per project, layer and pushed head. */
export const admissionId = (params: AdmissionParams) =>
  instanceId(`admit-${params.project}-${params.layer}`, `-${params.head}`);

/**
 * The instance a draft's round runs as: one per project, proposal and
 * round, the proposal and round kept whole.
 */
export const draftId = (
  params: Pick<DraftParams, "project" | "proposal" | "round">
) =>
  instanceId(`draft-${params.project}`, `-${params.proposal}-r${params.round}`);
