import type { StageName } from "@repo/protocol/domain/outcome";
import type { Refusal } from "@repo/protocol/refusal";
import type { Effect } from "effect";

import type { PushFacts } from "./facts.ts";

export interface Stage<R> {
  readonly name: StageName;
  readonly accumulate: boolean;
  readonly run: (
    facts: PushFacts
  ) => Effect.Effect<readonly Refusal[], never, R>;
}
