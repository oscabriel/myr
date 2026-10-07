/**
 * Server sides for tests. Test code alone imports this module: other
 * workspaces through `@repo/protocol/testing`, protocol's own tests by
 * relative path. Nothing under any `src/` may.
 */
import { Effect, Layer } from "effect";

import { Handle } from "./ids.ts";
import { Authenticated, CurrentPrincipal, Person } from "./principal.ts";

/** A server side that takes every call as `handle`, for tests with several people. */
export const asPerson = (handle: Handle): Layer.Layer<Authenticated> =>
  Layer.succeed(Authenticated, (effect) =>
    Effect.provideService(effect, CurrentPrincipal, Person.make({ handle }))
  );

/** A server side that takes every call as one person, for tests about other things. */
export const asTester: Layer.Layer<Authenticated> = asPerson(
  Handle.make("tester")
);
