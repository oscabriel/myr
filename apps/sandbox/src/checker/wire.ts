/**
 * A check job as the Checker reads it: `CheckWire` (301), plus the project's
 * run block, which says how to set up (`setup`, `setupEgress`, `image`).
 * `CheckJob` does not carry it yet, so the field is optional here and a job
 * without it is `VerifierBlocked`: the Checker never guesses a project's
 * setup (W3 315, Comments: `CheckJob` should carry `run`, and this module
 * then goes).
 */
import { CheckJob } from "@repo/checks/check-runner";
import { Remote } from "@repo/checks/check-runner/wire";
import { RunBlock } from "@repo/protocol/domain/run";
import { Schema } from "effect";

export const CheckerJob = Schema.Struct({
  ...CheckJob.fields,
  run: Schema.optionalKey(RunBlock),
});

export type CheckerJob = typeof CheckerJob.Type;

/** `CheckWire`, whose job may carry its run block. */
export const CheckerWire = Schema.Struct({ clone: Remote, job: CheckerJob });

export type CheckerWire = typeof CheckerWire.Type;
