import { Client, Contracts } from "@repo/protocol/contracts";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { backend } from "#backend";

import type { Backend } from "./rpc.ts";

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

export const serverClient: (
  env: Env,
  request?: Request
) => Layer.Layer<Client> = serverClientOver(backend);
