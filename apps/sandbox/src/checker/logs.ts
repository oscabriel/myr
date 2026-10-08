/**
 * Where a check's raw output goes: to the platform's side, never into the
 * result an answerer reads (a `LaneResult` names a log by
 * its `logRef`, and the platform writes it through `EvidenceStore`).
 *
 * The check's wire carries no logs yet, so the Worker's
 * adapter (`logs/worker.ts`) writes each one to the Worker's own logs, its
 * tail only; tests record them (`test/fake-box.ts`).
 */
import { Context } from "effect";
import type { Effect } from "effect";

/** One phase's output: the clone's, setup's, or one lane's. */
export interface PhaseLog {
  readonly phase: "clone" | "setup" | "lane";
  /** The lane's name, or the phase's own. */
  readonly name: string;
  readonly text: string;
}

export class CheckLogs extends Context.Service<
  CheckLogs,
  {
    /** Hands over every log the check wrote, once, when it ends. */
    readonly report: (logs: readonly PhaseLog[]) => Effect.Effect<void>;
  }
>()("sandbox/CheckLogs") {}
