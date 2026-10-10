/**
 * A `Client` of a fresh dev world with its fixtures, as a route's loader
 * calls the platform on the server: signed in as `handle`, or as nobody.
 */
import { Client, Contracts } from "@repo/protocol/contracts";
import { Handle } from "@repo/protocol/ids";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { devServer } from "../src/dev/server.ts";
import { devToken } from "../src/dev/sessions.ts";

export const fixturesClient = (handle?: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { dispose, handler } = devServer({ fixtures: "on" });

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      return Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
        Layer.provide(
          RpcClient.layerProtocolHttp({
            transformClient: HttpClient.mapRequest((request) =>
              handle === undefined
                ? request
                : HttpClientRequest.bearerToken(
                    request,
                    devToken(Handle.make(handle))
                  )
            ),
            url: "http://localhost/rpc",
          })
        ),
        Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
        Layer.provide(
          Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
            handler(new Request(input, init))
          )
        )
      );
    })
  );
