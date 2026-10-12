import { Context } from "effect";
import type { Effect } from "effect";

export interface PhaseLog {
  readonly phase: "clone" | "setup" | "lane";
  readonly name: string;
  readonly text: string;
}

export class CheckLogs extends Context.Service<
  CheckLogs,
  {
    readonly report: (logs: readonly PhaseLog[]) => Effect.Effect<void>;
  }
>()("sandbox/CheckLogs") {}
