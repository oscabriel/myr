/**
 * Where a check's raw output goes: to the platform's side, never into the
 * result an answerer reads (spec §2.3 `LaneResult`: the result names a log by
 * its `logRef`, and the platform writes it through `EvidenceStore`).
 *
 * The check's wire carries no logs yet (W3 315, Comments), so the Worker's
 * adapter writes each one to the Worker's own logs, its tail only.
 */
import { Context, Effect, Layer } from "effect";

/** One phase's output: the clone's, setup's, or one lane's. */
export interface PhaseLog {
  readonly phase: "clone" | "setup" | "lane";
  /** The lane's name, or the phase's own. */
  readonly name: string;
  readonly text: string;
}

/** The most of a log the Worker's own logs keep: its last 8 KiB. */
const TAIL = 8 * 1024;

export class CheckLogs extends Context.Service<
  CheckLogs,
  {
    /** Hands over every log the check wrote, once, when it ends. */
    readonly report: (logs: readonly PhaseLog[]) => Effect.Effect<void>;
  }
>()("sandbox/CheckLogs") {
  /** Each log as one line in the Worker's logs, annotated with its phase. */
  static readonly logged: Layer.Layer<CheckLogs> = Layer.succeed(
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
  );
}
