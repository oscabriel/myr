/**
 * The web's projection of the contracts (AGENTS.md principle 4): the only
 * place the web builds one.
 *
 * The data pattern every view follows (W5, W6):
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
 * `#backend` carries to the platform.
 */
import { surfaced } from "@repo/protocol/contracts";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { AtomRpc } from "effect/reactivity";
import { RpcClient, RpcSerialization } from "effect/rpc";

/** The contracts whose `Surfaces` annotation includes `web`. */
export const webContracts = surfaced("web");

/** The web's contracts as atoms: `ContractsClient.query(tag, payload, options)` and `ContractsClient.mutation(tag)`. */
export class ContractsClient extends AtomRpc.Service<ContractsClient>()(
  "web/ContractsClient",
  {
    group: webContracts,
    // JSON, as the platform's `/rpc` serves it.
    protocol: RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
      Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
    ),
  }
) {}
