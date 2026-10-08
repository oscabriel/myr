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
 */
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

/** Every run the `Answer` Workflow takes: an admission's, or an answer's. */
export const WorkflowParams = Schema.Union([AdmissionParams, AnswerParams]);

export type WorkflowParams = typeof WorkflowParams.Type;

/** How long a Workflow instance id may be. */
const ID_LENGTH = 100;

/** The instance an admission runs as: one per project, layer and pushed head. */
export const admissionId = (params: AdmissionParams) =>
  `admit-${params.project}-${params.layer}-${params.head}`.slice(0, ID_LENGTH);
