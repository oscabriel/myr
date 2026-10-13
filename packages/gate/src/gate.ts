/**
 * Stops after the first stage that refuses, so a push never pays for a stage
 * past its cheapest problem.
 */
import type { StageName } from "@repo/protocol/domain/outcome";
import type { Refusal } from "@repo/protocol/refusal";
import { Array, Effect, Option } from "effect";

import type { PushFacts } from "./facts.ts";
import type { Stage } from "./stage.ts";
import { parse } from "./stages/parse.ts";
import { scan } from "./stages/shape.ts";

/** What the first stage that refused a push refused it for. */
export interface StageRefusal {
  readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
  readonly stage: StageName;
}

export const refusingStage = <R>(
  stages: readonly Stage<R>[],
  facts: PushFacts
): Effect.Effect<Option.Option<StageRefusal>, never, R> =>
  Effect.gen(function* () {
    for (const stage of stages) {
      const refusals = yield* stage.run(facts);

      if (Array.isReadonlyArrayNonEmpty(refusals)) {
        return Option.some({
          refusals: stage.accumulate
            ? refusals
            : Array.of(Array.headNonEmpty(refusals)),
          stage: stage.name,
        });
      }
    }

    return Option.none();
  });

export const runGate = <R>(
  stages: readonly Stage<R>[],
  facts: PushFacts
): Effect.Effect<
  Option.Option<Array.NonEmptyReadonlyArray<Refusal>>,
  never,
  R
> =>
  Effect.map(
    refusingStage(stages, facts),
    Option.map(({ refusals }) => refusals)
  );

export const pushStages: readonly Stage<never>[] = [parse, scan];
