/**
 * The `Answer` Workflow: carries one admitted answer through merge, checks
 * and landing, each a durable step (spec §5 step 7). A stub until W3 304
 * builds it: it has no `run` yet, so an instance fails at once. The class
 * name is frozen.
 */
import { WorkflowEntrypoint } from "cloudflare:workers";

import type { AnswerParams } from "../answer-runs.ts";

export class Answer extends WorkflowEntrypoint<
  Env,
  typeof AnswerParams.Encoded
> {}
