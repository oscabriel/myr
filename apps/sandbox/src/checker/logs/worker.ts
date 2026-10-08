/**
 * `CheckLogs` as the sandbox Worker's own logs: each phase's log as one log
 * line, its tail only, annotated with its phase and name. The check's wire
 * carries no logs yet, so this is where they go until the
 * platform stores them through `EvidenceStore`.
 */
import { Effect, Layer } from "effect";

import { CheckLogs } from "../logs.ts";

/** The most of a log the Worker's own logs keep: its last 8 KiB. */
const TAIL = 8 * 1024;

export const WorkerCheckLogs = {
  layer: Layer.succeed(
    CheckLogs,
    CheckLogs.of({
      report: (logs) =>
        Effect.forEach(
          logs,
          ({ name, phase, text }) =>
            Effect.logInfo(text.slice(-TAIL)).pipe(
              Effect.annotateLogs({ log: name, phase })
            ),
          { discard: true }
        ),
    })
  ),
};
