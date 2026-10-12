import type { Decide } from "@repo/protocol/contracts";
import { Effect } from "effect";
import { Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const decideAtom = ContractsClient.runtime.fn<
  typeof Decide.payloadSchema.Type
>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* ContractsClient;

    return yield* client("decide", input).pipe(
      Reactivity.mutation([...keys.today(), ...keys.project(input.project)]),
      Effect.tapErrorTag(["DecisionClosed", "UnknownDecision"], () =>
        Reactivity.invalidate(keys.today())
      )
    );
  })
);
