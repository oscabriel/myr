/**
 * `#backend` under the `development` condition (`vite dev`, vitest): the
 * contracts served in process by the dev world, so the web runs with no
 * platform, no Artifacts and no network. The browser reaches it through
 * the same `/rpc` route, the same `Contracts` group and the same atoms as
 * production; only this target differs.
 *
 * `POST /rpc` is an `RpcServer` over `Contracts` with the dev handlers,
 * protocol's `Authenticated` server side over dev tokens (`sessions.ts`)
 * and JSON, as the platform's `/rpc` serves it. The world is built and
 * seeded once per isolate, on the first request. Nothing outside
 * `src/dev/` imports this file, and the production build carries none of
 * it (505's production-bundle test).
 */
import { Contracts } from "@repo/protocol/contracts";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import type { Backend } from "../server/rpc.ts";
import { devHandlers } from "./handlers.ts";
import { seedDev } from "./seed.ts";
import { devSessions } from "./sessions.ts";
import { devWorld } from "./world.ts";

/** A fresh world, seeded. */
export const seededWorld = Layer.effectDiscard(seedDev).pipe(
  Layer.provideMerge(devWorld)
);

/** The contracts at `/rpc` over a world, as a fetch handler: the seam `backend` is. */
export const devServer = () =>
  HttpRouter.toWebHandler(
    RpcServer.layerHttp({
      group: Contracts,
      path: "/rpc",
      protocol: "http",
    }).pipe(
      Layer.provide([devHandlers, devSessions, RpcSerialization.layerJson]),
      Layer.provide(seededWorld)
    ),
    { disableLogger: true }
  );

// Built at module load, touching nothing: the world is made and seeded on
// the first request, then kept for the isolate's life.
const served = devServer();

/** The development backend: every request answered by the dev world, the env unused. */
export const backend: Backend = (request) => served.handler(request);
