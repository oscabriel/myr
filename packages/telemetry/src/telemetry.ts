// One layer per Worker runtime: its logger, its crash reporting and its
// spans. A Worker composes it where it composes its ports, with every secret
// its env holds and its own `tracing`; nothing it logs, reports or traces
// carries one of those secrets.
import { ErrorReporter, Layer, Logger } from "effect";
import type { Redacted } from "effect";

import { defectReporter } from "./defects.ts";
import type { DefectKeeping } from "./defects.ts";
import { jsonLogger, scrubberOf } from "./logger.ts";
import type { WorkerTracing } from "./spans.ts";
import { SpansBinding } from "./spans/binding.ts";

export interface TelemetryOptions {
  readonly secrets: readonly Redacted.Redacted[];
  readonly tracing: WorkerTracing;
  /** What a report and a span keep of a defect; all of it, scrubbed, unless named. */
  readonly defects?: DefectKeeping;
}

export const Telemetry = ({
  defects = "whole",
  secrets,
  tracing,
}: TelemetryOptions): Layer.Layer<never> => {
  const scrub = scrubberOf(secrets);

  return Layer.mergeAll(
    Logger.layer([jsonLogger(scrub)]),
    ErrorReporter.layer([defectReporter(defects)]),
    SpansBinding(tracing, { defects, scrub })
  );
};
