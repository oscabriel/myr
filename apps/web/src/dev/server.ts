import { RepoHost } from "@repo/artifacts/repo-host";
import { CodeStore } from "@repo/project/code-store";
import { CodeCache } from "@repo/project/code/cache";
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

export interface DevWorldOptions {
  readonly fixtures?: FixtureMode;
  readonly liveAfter?: Duration.Duration;
  readonly time?: "fixed" | "present";
}

const seedEndOf = (fixtures: FixtureMode) =>
  fixtures === "off" ? seedEnd : fixturesNow;

const seededFrom = (start: DateTime.Utc, options: DevWorldOptions) => {
  const { fixtures = "off" } = options;

  return fixtures === "off"
    ? Layer.effectDiscard(seedDev).pipe(Layer.provideMerge(devWorldAt(start)))
    : withFixtures(fixtures, options.liveAfter, start);
};

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

const raw = Layer.unwrap(
  Effect.gen(function* () {
    const services = Context.make(RepoHost, yield* RepoHost).pipe(
      Context.add(Projects, yield* Projects),
      Context.add(CodeCache, yield* CodeCache),
      Context.add(CodeStore, yield* CodeStore)
    );

    const answer = Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const request = yield* HttpServerRequest.HttpServerRequest;

      const spelled = [params.host, params.owner, params.project]
        .filter((segment) => segment !== undefined)
        .join("/");

      return yield* Option.match(decodeProject(spelled), {
        onNone: () => Effect.succeed(HttpServerResponse.empty({ status: 404 })),
        onSome: (project) =>
          rawFor(project, request.url).pipe(
            Effect.provide(services),
            Effect.map(HttpServerResponse.fromWeb)
          ),
      });
    });

    return Layer.mergeAll(
      HttpRouter.add("GET", "/:project/raw/*", answer),
      HttpRouter.add("GET", "/:owner/:project/raw/*", answer),
      HttpRouter.add("GET", "/:host/:owner/:project/raw/*", answer)
    );
  })
);

// `toWebHandler` builds its layer as soon as it is called; a request that arrives before the seed is done waits for it.
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
