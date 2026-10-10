/**
 * The web's projection of the contracts (AGENTS.md principle 4): the only
 * place the web builds one.
 *
 * The data pattern every view follows:
 *
 * - `src/features/<name>/` holds views only: props in, markup out, and no
 *   transport import.
 * - `src/client/<name>.ts` holds that feature's atoms over `ContractsClient`,
 *   with reactivity keys from `src/client/keys.ts`, so a mutation refetches
 *   the reads it changes. Views never import `ContractsClient`.
 * - Route files wire atoms to views.
 * - Server routes that answer agents (Markdown, `llms.txt`) call contracts
 *   through `serverClient` (`src/server/client.ts`), never through atoms.
 *
 * The atoms run in the browser, against the same-origin `/rpc`, which
 * `#backend` carries to the platform. A stream the page follows as it
 * happens (`watch`) goes over the framed `/rpc` instead (`framedClient`).
 */
import { surfaced } from "@repo/protocol/contracts";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Atom, AtomRpc } from "effect/reactivity";
import { RpcClient, RpcSerialization } from "effect/rpc";

/** The contracts whose `Surfaces` annotation includes `web`. */
export const webContracts = surfaced("web");

/**
 * The runtimes the web's atoms run on, over one memo map for every
 * registry, so they share one `Reactivity`: a page's atoms live in a
 * registry of the page's own (`client/seeded.ts`) and the rail's in the
 * root's, and a write or an event heard on the page must refetch the
 * rail's counts too. A layer built for several registries is released
 * when the last of them lets it go.
 */
export const sharedRuntime = Atom.context({
  memoMap: Layer.makeMemoMapUnsafe(),
});

/** The web's contracts as atoms: `ContractsClient.query(tag, payload, options)` and `ContractsClient.mutation(tag)`. */
export class ContractsClient extends AtomRpc.Service<ContractsClient>()(
  "web/ContractsClient",
  {
    group: webContracts,
    runtime: sharedRuntime,
    // JSON, as the platform's `/rpc` serves it.
    protocol: RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
      Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
    ),
  }
) {}

/**
 * The web's contracts over the framed `/rpc` (NDJSON), which the platform
 * answers message by message, so a stream stays open for as long as the
 * page reads it: how a page follows `watch` (`client/watch.ts`).
 */
export const framedClient = RpcClient.make(webContracts).pipe(
  Effect.provide(
    RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
      Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson])
    )
  )
);
