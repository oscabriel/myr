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
import type { DateTime, Duration } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { DevClock, devStart, startEndingNow } from "./clock.ts";
import { withFixtures } from "./fixtures.ts";
import type { FixtureMode } from "./fixtures.ts";
import { fixturesNow } from "./fixtures/vellum.ts";
import { devHandlers } from "./handlers.ts";
import { seedDev, seedEnd } from "./seed.ts";
import { devSessions } from "./sessions.ts";
import { devWorldAt } from "./world.ts";

/** How a dev world is made: with the fixtures or without, how soon the live landing comes, and when it is. */
export interface DevWorldOptions {
  readonly fixtures?: FixtureMode;
  /** In `live` mode, how long after vellum's `watch` is first answered its lint child lands. */
  readonly liveAfter?: Duration.Duration;
  /**
   * Where the world's time stands. `"fixed"`, as a test builds it: the
   * calendar as written, from `devStart`, and the clock standing where the
   * seed left it. `"present"`, as the running dev server builds it: the
   * calendar moved so the seed's last instant is the minute the world is
   * built in, and the clock running on from there in real time.
   */
  readonly time?: "fixed" | "present";
}

/** The calendar's instant a seed with `fixtures` leaves the clock at. */
const seedEndOf = (fixtures: FixtureMode) =>
  fixtures === "off" ? seedEnd : fixturesNow;

/** A fresh world whose calendar starts at `start`, seeded; with the fixtures when `fixtures` asks for them. */
const seededFrom = (start: DateTime.Utc, options: DevWorldOptions) => {
  const { fixtures = "off" } = options;

  return fixtures === "off"
    ? Layer.effectDiscard(seedDev).pipe(Layer.provideMerge(devWorldAt(start)))
    : withFixtures(fixtures, options.liveAfter, start);
};

/** A fresh world, seeded, at the time `options` asks for. */
const seededWorld = (options: DevWorldOptions) => {
  const { fixtures = "off", time = "fixed" } = options;

  return time === "fixed"
    ? seededFrom(devStart, options)
    : Layer.unwrap(
        Effect.map(startEndingNow(seedEndOf(fixtures)), (start) =>
          Layer.effectDiscard(
            Effect.flatMap(Effect.service(DevClock), (clock) => clock.run)
          ).pipe(Layer.provideMerge(seededFrom(start, options)))
        )
      );
};

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
export const devServer = (options: DevWorldOptions = {}) =>
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
    ).pipe(Layer.provide(seededWorld(options))),
    { disableLogger: true }
  );
