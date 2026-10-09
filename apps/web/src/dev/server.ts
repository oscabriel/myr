/**
 * The dev world as a fetch handler: `POST /rpc` is an `RpcServer` over
 * `Contracts` with the dev handlers, protocol's `Authenticated` server side
 * over dev tokens (`sessions.ts`) and JSON, as the platform's `/rpc` serves
 * it, over a fresh world the seed has brought to its state; and
 * `GET /<project>/raw/<rev>/<path…>` answers a project's raw files with
 * the response the platform's `raw.ts` gives (`@repo/project/code/raw`).
 * `backend.ts` makes the one an isolate serves; a test makes its own.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import { rawFor } from "@repo/project/code/raw";
import { Projects } from "@repo/project/projects";
import { Contracts } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { devHandlers } from "./handlers.ts";
import { seedDev } from "./seed.ts";
import { devSessions } from "./sessions.ts";
import { devWorld } from "./world.ts";

/** A fresh world, seeded. */
const seededWorld = Layer.effectDiscard(seedDev).pipe(
  Layer.provideMerge(devWorld)
);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/** `/<project>/raw/<rev>/<path…>`: a project's raw files, as the platform serves them. */
const raw = Layer.unwrap(
  Effect.gen(function* () {
    const services = Context.make(RepoHost, yield* RepoHost).pipe(
      Context.add(Projects, yield* Projects)
    );

    return HttpRouter.add(
      "GET",
      "/:project/raw/*",
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;
        const request = yield* HttpServerRequest.HttpServerRequest;

        return yield* Option.match(decodeProject(params.project), {
          onNone: () =>
            Effect.succeed(HttpServerResponse.empty({ status: 404 })),
          onSome: (project) =>
            rawFor(project, request.url).pipe(
              Effect.provide(services),
              Effect.map(HttpServerResponse.fromWeb)
            ),
        });
      })
    );
  })
);

/**
 * The contracts at `/rpc` and the raw files over a fresh, seeded world. `toWebHandler` builds
 * its layer as soon as it is called, so the world is made and seeded from
 * that moment, and a request that arrives before the seed is done waits for
 * it. `dispose` ends the world.
 */
export const devServer = () =>
  HttpRouter.toWebHandler(
    Layer.merge(
      RpcServer.layerHttp({
        group: Contracts,
        path: "/rpc",
        protocol: "http",
      }).pipe(
        Layer.provide([devHandlers, devSessions, RpcSerialization.layerJson])
      ),
      raw
    ).pipe(Layer.provide(seededWorld)),
    { disableLogger: true }
  );
