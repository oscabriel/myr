import { surfaced } from "@repo/protocol/contracts";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Atom, AtomRpc } from "effect/reactivity";
import { RpcClient, RpcSerialization } from "effect/rpc";

export const webContracts = surfaced("web");

// One memo map for every registry, so they share one `Reactivity`: a write on a page's own registry
// must refetch the shell's counts in the root's too.
export const sharedRuntime = Atom.context({
  memoMap: Layer.makeMemoMapUnsafe(),
});

export class ContractsClient extends AtomRpc.Service<ContractsClient>()(
  "web/ContractsClient",
  {
    group: webContracts,
    runtime: sharedRuntime,
    protocol: RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
      Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
    ),
  }
) {}

// NDJSON, which the platform answers message by message, so a stream stays open while the page reads it.
export const framedClient = RpcClient.make(webContracts).pipe(
  Effect.provide(
    RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
      Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson])
    )
  )
);
