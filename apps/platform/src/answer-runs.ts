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
 * no Workflow binding (W9-D14). Its instance id is `draftId`, one per
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

/** The instance an admission runs as: one per project, layer and pushed head. */
export const admissionId = (params: AdmissionParams) =>
  `admit-${params.project}-${params.layer}-${params.head}`.slice(0, ID_LENGTH);

/** The instance a draft's round runs as: one per project, proposal and round. */
export const draftId = (
  params: Pick<DraftParams, "project" | "proposal" | "round">
) =>
  `draft-${params.project}-${params.proposal}-r${params.round}`.slice(
    0,
    ID_LENGTH
  );
