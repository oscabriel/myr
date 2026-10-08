/**
 * The contracts for server routes that answer agents (`llms.txt`, an ask as
 * Markdown): a protocol `Client` whose calls go to `/rpc` through the same
 * backend the browser's do, in process, so a server route needs no network
 * hop and meets the same credential rule.
 */
import { Client, Contracts } from "@repo/protocol/contracts";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { backend } from "#backend";

import type { Backend } from "./rpc.ts";

/**
 * A `fetch` that hands each request to `backend` with `env`, carrying the
 * caller's cookie when there is a caller, so `backend` treats the call as
 * the browser's own.
 */
const inProcess =
  (over: Backend, env: Env, caller: Request | undefined): typeof fetch =>
  (input, init) => {
    const request = new Request(input, init);
    const cookie = caller?.headers.get("cookie");

    if (cookie !== null && cookie !== undefined) {
      request.headers.set("cookie", cookie);
    }

    return over(request, env);
  };

/** `serverClient` over any backend: the seam its test drives. */
export const serverClientOver =
  (over: Backend) =>
  (env: Env, request?: Request): Layer.Layer<Client> =>
    Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
      Layer.provide(
        RpcClient.layerProtocolHttp({
          url: new URL("/rpc", request?.url ?? env.PUBLIC_PLATFORM_URL).href,
        })
      ),
      Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
      Layer.provide(
        Layer.succeed(FetchHttpClient.Fetch)(inProcess(over, env, request))
      )
    );

/** The contracts as a server route calls them, through `#backend`. */
export const serverClient: (
  env: Env,
  request?: Request
) => Layer.Layer<Client> = serverClientOver(backend);
