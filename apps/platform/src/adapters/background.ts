import { Background } from "@repo/project/background";
import { Effect, Fiber, Layer } from "effect";

/** `DurableObjectState.waitUntil`, which takes a `Promise<any>`. */
export interface BackgroundHost {
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * A fiber of the DO's own runtime, which lives on past the call that forked
 * it; `waitUntil` names the fiber's end to the runtime as the call's own work.
 */
export const DoBackground = (host: BackgroundHost) =>
  Layer.succeed(Background, {
    run: (work) =>
      Effect.map(Effect.forkDetach(work), (fiber) => {
        host.waitUntil(Effect.runPromise(Fiber.await(fiber)));
      }),
  });
