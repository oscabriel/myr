// Each `client-*.test.ts` file reads the one world its module's `backend` seeds, in order;
// within a file, only the last test changes it.
import { ProjectName } from "@repo/protocol/ids";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import type { AsyncResult } from "effect/reactivity";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { backend } from "#backend";

import { SESSION_COOKIE } from "../src/server/session.ts";
import { ContractsClient, webContracts } from "../src/surfaces.ts";

export const WEB_URL = "http://localhost:3000";

export const datekit = ProjectName.make("oscabriel/datekit");

export const DECIDER = "dev-ines-v";

const browser = (token?: string) =>
  Layer.effect(
    ContractsClient,
    RpcClient.make(webContracts, { flatten: true })
  ).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({
        transformClient: HttpClient.mapRequest((request) =>
          token === undefined
            ? request
            : HttpClientRequest.setHeader(
                request,
                "cookie",
                `${SESSION_COOKIE}=${token}`
              )
        ),
        url: `${WEB_URL}/rpc`,
      })
    ),
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
        backend(new Request(input, init), env)
      )
    ),
    Layer.provideMerge(Reactivity.layer)
  );

export const registryAs = (token?: string) =>
  AtomRegistry.make({
    initialValues: [
      Atom.initialValue(ContractsClient.runtime.layer, browser(token)),
    ],
  });

export const settled = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.exit(
    AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })
  );

// Cold seeding while turbo runs every package's tests at once comes near vitest's 5 s default.
export const seededWorld = { timeout: 30_000 };
