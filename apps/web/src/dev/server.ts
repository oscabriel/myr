/**
 * The dev world as a fetch handler: `POST /rpc` is an `RpcServer` over
 * `Contracts` with the dev handlers, protocol's `Authenticated` server side
 * over dev tokens (`sessions.ts`) and JSON, as the platform's `/rpc` serves
 * it, over a fresh world the seed has brought to its state. `backend.ts`
 * makes the one an isolate serves; a test makes its own.
 */
import { Contracts } from "@repo/protocol/contracts";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { devHandlers } from "./handlers.ts";
import { seedDev } from "./seed.ts";
import { devSessions } from "./sessions.ts";
import { devWorld } from "./world.ts";

/** A fresh world, seeded. */
const seededWorld = Layer.effectDiscard(seedDev).pipe(
  Layer.provideMerge(devWorld)
);

/**
 * The contracts at `/rpc` over a fresh, seeded world. `toWebHandler` builds
 * its layer as soon as it is called, so the world is made and seeded from
 * that moment, and a request that arrives before the seed is done waits for
 * it. `dispose` ends the world.
 */
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
