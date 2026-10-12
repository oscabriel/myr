import { VerifierBlocked } from "@repo/protocol/refusal";
import { Schema } from "effect";

import { CheckJob, CheckRun } from "../check-runner.ts";

// The token never enters a Checker's container: the outbound handler adds it.
export const Remote = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.String),
  url: Schema.NonEmptyString,
});

export type Remote = typeof Remote.Type;

export const CheckWire = Schema.Struct({ clone: Remote, job: CheckJob });

export type CheckWire = typeof CheckWire.Type;

export const CheckExit = Schema.toCodecJson(
  Schema.Exit(CheckRun, VerifierBlocked, Schema.Defect())
);
