/**
 * Stops after the first stage that refuses, so a push never pays for a stage
 * past its cheapest problem.
 */
import type { Refusal } from "@repo/protocol/refusal";
import { Array, Effect, Option } from "effect";

import type { PushFacts } from "./facts.ts";
import type { Stage } from "./stage.ts";
import { parse } from "./stages/parse.ts";
import { scan } from "./stages/shape.ts";

export const runGate = <R>(
  stages: readonly Stage<R>[],
  facts: PushFacts
): Effect.Effect<
  Option.Option<Array.NonEmptyReadonlyArray<Refusal>>,
  never,
  R
> =>
  Effect.gen(function* () {
    for (const stage of stages) {
      const refusals = yield* stage
        .run(facts)
        .pipe(Effect.withSpan(`Gate.${stage.name}`));

      if (Array.isReadonlyArrayNonEmpty(refusals)) {
        return Option.some(
          stage.accumulate ? refusals : Array.of(Array.headNonEmpty(refusals))
        );
      }
    }

    return Option.none();
  });

export const pushStages: readonly Stage<never>[] = [parse, scan];
