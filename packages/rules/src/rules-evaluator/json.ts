import type { PolicyInput } from "@repo/protocol/domain/policy";
import { Effect, Layer, Option } from "effect";

import { fromPolicyJson } from "../config-folder.ts";
import { defaultPolicyInput } from "../defaults.ts";
import { Finishers, finishPolicy } from "../finish.ts";
import { RulesEvaluator } from "../rules-evaluator.ts";

/**
 * `RulesEvaluator` over a committed `policy.json` (the fallback): the policy
 * it states, or the defaults when the folder has none. It runs no code, so
 * it has no function-valued rules: `call` is always `false`.
 */
export const RulesEvaluatorJson = Layer.effect(
  RulesEvaluator,
  Effect.gen(function* () {
    const finishers = yield* Finishers;

    return RulesEvaluator.of({
      call: () => Effect.succeed(false),
      evaluate: ({ at, facts, modules }) =>
        Effect.gen(function* () {
          const policy = Option.getOrElse(
            yield* fromPolicyJson(modules),
            (): PolicyInput => defaultPolicyInput
          );

          return yield* finishPolicy({ at, facts, finishers, policy });
        }),
    });
  })
);
