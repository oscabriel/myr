import { Effect, Layer } from "effect";

import { CheckLogs } from "../logs.ts";

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
