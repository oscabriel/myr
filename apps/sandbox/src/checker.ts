/**
 * The Checker: one container per check, holding no credential, where an
 * answer's lanes run (spec §4.3). A stub until W3 315 builds its phases:
 * every check is `VerifierBlocked`. The class name is frozen.
 */
import { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { DurableObject } from "cloudflare:workers";

import { answerJob, notBuilt } from "./job.ts";

/** The Checker's Durable Object, which owns its container. */
export class Checker extends DurableObject<Env> {}

/** One check job from the platform, its outcome encoded. */
export const runCheck = (
  _env: Env,
  wire: typeof CheckWire.Encoded
): Promise<typeof CheckExit.Encoded> =>
  answerJob(CheckWire, CheckExit, () =>
    notBuilt("check", new VerifierBlocked({}))
  )(wire);
