import type { StageName } from "@repo/protocol/domain/outcome";
import type { Refusal } from "@repo/protocol/refusal";
import type { Effect } from "effect";

import type { PushFacts } from "./facts.ts";

/**
 * One stage of the gate: a decision over a push's facts that answers with
 * refusals, or none. An accumulating stage reports every refusal it finds; any
 * other stage stops the gate at its first.
 */
export interface Stage<R> {
  readonly name: StageName;
  readonly accumulate: boolean;
  readonly run: (
    facts: PushFacts
  ) => Effect.Effect<readonly Refusal[], never, R>;
}
