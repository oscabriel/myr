/**
 * A decider's choice on one decision, as a mutation atom over the `decide`
 * contract (the browser's `/rpc` call carries the session cookie).
 * A choice taken changes Today and the decision's project, so on
 * success both read again (`keys.today()`, `keys.project(project)`) and the
 * decision leaves Today. A choice that comes too late (`DecisionClosed`:
 * someone decided first, or it expired to its default) or names a decision
 * Today no longer has (`UnknownDecision`) fails with that refusal, and Today
 * reads again so the stale decision leaves the list.
 */
import type { Decide } from "@repo/protocol/contracts";
import { Effect } from "effect";
import { Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** Take one decision: `{ project, decision, choice, note? }`, answered with the decision as it now stands. */
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
