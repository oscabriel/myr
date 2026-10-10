/**
 * The web's contracts as its atoms read them, with `#backend` under the
 * `development` condition: the same `ContractsClient` group, the same
 * reactivity keys and the same `/rpc` path, answered by the dev world in
 * process instead of a platform. Each registry stands for one browser: its
 * client's requests carry that browser's session cookie, or none, which
 * the backend turns into the bearer the dev world reads.
 *
 * Each `client-*.test.ts` file reads the one world its module's `backend`
 * seeds, in order; within a file, only the last test changes it.
 */
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

export const datekit = ProjectName.make("datekit");

/** The decider of datekit in the dev world, and the token that signs them in. */
export const DECIDER = "dev-ines-v";

/**
 * `ContractsClient` as one browser runs it: its HTTP protocol posts to the
 * web's `/rpc`, which hands the request to `backend` in process, with
 * `token` in the session cookie when there is one.
 */
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

/** A registry whose `ContractsClient` is `browser(token)`'s. */
export const registryAs = (token?: string) =>
  AtomRegistry.make({
    initialValues: [
      Atom.initialValue(ContractsClient.runtime.layer, browser(token)),
    ],
  });

/** An atom's value once it has one, past any refetch under way. */
export const settled = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.exit(
    AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })
  );

/**
 * The first test of a file waits for its world to be seeded, cold, while
 * turbo runs every package's tests at once (near vitest's 5 s default).
 */
export const seededWorld = { timeout: 30_000 };
