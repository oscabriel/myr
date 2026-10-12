import { Client, Contracts } from "@repo/protocol/contracts";
import { asTester, unanswered } from "@repo/protocol/testing";
import { Layer } from "effect";
import { RpcTest } from "effect/rpc";

export const platformWith = (
  ...handlers: readonly Layer.Layer<never>[]
): Layer.Layer<Client> =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([Layer.mergeAll(unanswered, ...handlers), asTester])
  );

export const unreachablePlatform: Layer.Layer<Client> = platformWith();
