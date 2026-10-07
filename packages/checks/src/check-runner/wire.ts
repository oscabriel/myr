/**
 * What crosses the service binding between the platform and the sandbox
 * Worker for a check: the job, with the one remote the Checker clones from,
 * and the run's outcome on the way back. Both sides decode with these
 * schemas (principle 2): the platform encodes the job and decodes the
 * outcome (W3 314); the sandbox does the reverse (W3 315).
 */
import { VerifierBlocked } from "@repo/protocol/refusal";
import { Schema } from "effect";

import { CheckJob, CheckRun } from "../check-runner.ts";

/**
 * Where a sandbox job reaches one repo: its git URL and a token the platform
 * minted for this job alone. The token is redacted wherever it is printed,
 * and a Checker's never enters its container: the outbound handler adds it
 * (W3 315).
 */
export const Remote = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.String),
  url: Schema.NonEmptyString,
});

export type Remote = typeof Remote.Type;

/** A check job as the platform sends it: the job and a read token for its repo. */
export const CheckWire = Schema.Struct({ clone: Remote, job: CheckJob });

export type CheckWire = typeof CheckWire.Type;

/**
 * A check's outcome as it comes back: the run, `VerifierBlocked`, or a
 * defect, as JSON.
 */
export const CheckExit = Schema.toCodecJson(
  Schema.Exit(CheckRun, VerifierBlocked, Schema.Defect())
);
