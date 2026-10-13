// The sandbox's telemetry: its JSON logger and its spans, over the Worker's
// own `tracing`. The env holds no secret; a job's tokens are the secrets its
// lines must never carry, so each job runs with its own.
import { Telemetry } from "@repo/telemetry/telemetry";
import type { TelemetryOptions } from "@repo/telemetry/telemetry";
import { tracing } from "cloudflare:workers";
import type { Layer, Redacted } from "effect";

export const jobTelemetry = (
  tokens: readonly Redacted.Redacted[],
  defects: TelemetryOptions["defects"] = "whole"
): Layer.Layer<never> => Telemetry({ defects, secrets: tokens, tracing });
