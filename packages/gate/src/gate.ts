/**
 * The gate: a push's stages, run in order of cost. It stops after the first
 * stage that refuses, so a push never pays for a stage past its cheapest
 * problem (ADR 0006).
 */
import type { Refusal } from "@repo/protocol/refusal";
import { Array, Effect, Option } from "effect";

import type { PushFacts } from "./facts.ts";
import type { Stage } from "./stage.ts";
import { parse } from "./stages/parse.ts";
import { scan } from "./stages/shape.ts";

/**
 * Runs `stages` over the push in order, and answers with the refusals of the
 * first stage that has any: all of them when it accumulates, its first
 * otherwise. `None` means the push may go on to merge and checks.
 */
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
      const refusals = yield* stage.run(facts);

      if (Array.isReadonlyArrayNonEmpty(refusals)) {
        return Option.some(
          stage.accumulate ? refusals : Array.of(Array.headNonEmpty(refusals))
        );
      }
    }

    return Option.none();
  });

/** Stages 0 and 1: what the gateway and `submitAnswer` run before answering a push. */
export const pushStages: readonly Stage<never>[] = [parse, scan];
