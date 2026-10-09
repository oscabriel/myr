/**
 * A router's fetch handler, built before it answers anything.
 *
 * effect's `HttpRouter.toWebHandler` starts the layer's build when the
 * handler is made and has every request await that one build. On Workers
 * a request whose client goes away is cancelled where it stands, its
 * fibers never resumed: had the build awaited I/O a request started, every
 * later request would wait on it for the isolate's life (the 1101 hang
 * the code cache once had). Here the build runs at once, synchronously, so
 * it cannot await anything: a layer that awaits a promise or a timer while
 * it is built throws where the handler is made, which at module load stops
 * the Worker from starting (and a deploy from going out). Such work belongs
 * in the request path, per request. A build that fails otherwise (an env
 * that did not decode) fails every request with its error, as effect's does.
 *
 * Only the build's own fiber is run to its end here: a fiber the build forks
 * (a layer built beside others) that outlasts its turn and yields is
 * refused as if it had awaited. Both real compositions are built in
 * `test/router-build.test.ts`, so such a build fails `verify`, never a
 * deploy.
 */
import {
  Cause,
  Context,
  Data,
  Effect,
  Exit,
  Layer,
  Scheduler,
  Scope,
} from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpEffect, HttpRouter } from "effect/http";

/** A router's build awaited a promise or a timer; nothing was served. */
export class RouterBuildAwaited extends Data.TaggedError("RouterBuildAwaited")<{
  readonly message: string;
}> {}

/** What a request needs beyond itself: the services `R`'s routes require of it. */
type RequestNeeds<A, R> = Exclude<
  | HttpRouter.Request.Only<"Requires", R>
  | HttpRouter.Request.Only<"GlobalRequires", R>,
  A | Scope.Scope | HttpServerRequest.HttpServerRequest
>;

/**
 * `appLayer`'s routes as a fetch handler, its layer built now; a request
 * that needs services of its own (`RequestNeeds`) is given them as its
 * context. `dispose` closes what the build opened.
 */
export const buildHandler = <
  A,
  E,
  R extends
    | HttpRouter.HttpRouter
    | HttpRouter.Request<"Requires", unknown>
    | HttpRouter.Request<"GlobalRequires", unknown>
    | HttpRouter.Request<"Error", unknown>
    | HttpRouter.Request<"GlobalError", unknown>,
>(
  appLayer: Layer.Layer<A, E, R>
) => {
  const scope = Scope.makeUnsafe();

  // SAFETY: what `R` adds to `HttpRouter` are `HttpRouter.Request` markers,
  // which name what each request is given (its context) or may fail with,
  // never a service the build needs; effect's `toWebHandler` drops them the
  // same way.
  /* oxlint-disable typescript/no-unsafe-type-assertion -- the markers are phantom types with no service behind them; see SAFETY. */
  // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off -- the markers are phantom types with no service behind them; see SAFETY.
  const routed = Layer.provideMerge(appLayer, HttpRouter.layer) as Layer.Layer<
    A | HttpRouter.HttpRouter,
    E
  >;
  /* oxlint-enable typescript/no-unsafe-type-assertion */

  // `runSyncExit` runs its fiber on a scheduler of its own, which yields
  // through microtasks and would ride along in any context a layer captures
  // while it is built (`authenticated` verifies every credential in the
  // one it captured). The build runs on the scheduler a fiber has by default
  // instead; `runSyncExit` still drains what it schedules before it returns.
  const built = Effect.runSyncExit(
    Layer.buildWithScope(routed, scope).pipe(
      Effect.provideService(
        Scheduler.Scheduler,
        Scheduler.Scheduler.defaultValue()
      )
    )
  );

  const awaited =
    Exit.isFailure(built) &&
    built.cause.reasons.some(
      (reason) =>
        Cause.isDieReason(reason) && Cause.isAsyncFiberError(reason.defect)
    );

  if (awaited) {
    throw new RouterBuildAwaited({
      message:
        "The router's build awaited a promise or a timer: move that work into the request path.",
    });
  }

  const serveRequest = Exit.match(built, {
    onFailure: (cause) => () => Effect.runPromise(Effect.failCause(cause)),
    onSuccess: (context) =>
      HttpEffect.toWebHandlerWith<
        A | HttpRouter.HttpRouter,
        HttpServerRequest.HttpServerRequest | Scope.Scope,
        never
      >(context)(
        // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- the router's own effect fails with whatever a route left unhandled, which `toWebHandlerWith` turns into a response (404 for no route), as effect's `toWebHandler` does with the same effect.
        Context.get(context, HttpRouter.HttpRouter).asHttpEffect()
      ),
  });

  /** One request, given `context` beside it: what `R`'s routes require of it. */
  const handler = (
    request: Request,
    context?: Context.Context<RequestNeeds<A, R>>
  ): Promise<Response> => serveRequest(request, context);

  return {
    dispose: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    handler,
  };
};
