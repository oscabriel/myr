/**
 * What starts the `Answer` Workflow for one answer request. The port that
 * starts it is W2 214's `AnswerRuns` (`@repo/project/answer-runs`); the
 * Project Durable Object implements it with its project bound (W3 302), and
 * the Workflow decodes these params (304). The instance id is the request
 * id, so a second start of one request changes nothing.
 */
import { ProjectName, RequestId } from "@repo/protocol/ids";
import { Schema } from "effect";

export const AnswerParams = Schema.Struct({
  project: ProjectName,
  requestId: RequestId,
});

export type AnswerParams = typeof AnswerParams.Type;
