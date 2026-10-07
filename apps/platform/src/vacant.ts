import { Contracts } from "@repo/protocol/contracts";
import { NotClaimed } from "@repo/protocol/refusal";
import { Effect } from "effect";

/**
 * The contracts before any project exists: there are no asks, so nobody holds
 * a claim. The Project Durable Object replaces this.
 */
export const Vacant = Contracts.toLayer({
  listAsks: () => Effect.succeed({ asks: [] }),
  submitAnswer: ({ ask }) => Effect.fail(NotClaimed.of(ask)),
});
