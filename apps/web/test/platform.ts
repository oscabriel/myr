/**
 * A platform for a test to read from: the contracts it sets up answer, and
 * every other dies on the way (`unanswered`), as the tester.
 */
import { Client, Contracts } from "@repo/protocol/contracts";
import { asTester, unanswered } from "@repo/protocol/testing";
import { Layer } from "effect";
import { RpcTest } from "effect/rpc";

/** A platform that answers only the contracts in `handlers`, each a `Contracts.toLayerHandler` layer. */
export const platformWith = (
  ...handlers: readonly Layer.Layer<never>[]
): Layer.Layer<Client> =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([Layer.mergeAll(unanswered, ...handlers), asTester])
  );

/** A platform that cannot be reached: every call dies on the way. */
export const unreachablePlatform: Layer.Layer<Client> = platformWith();
