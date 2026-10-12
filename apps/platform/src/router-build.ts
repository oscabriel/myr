// effect's `HttpRouter.toWebHandler` has every request await one layer build. On
// Workers a request whose client leaves is cancelled without resuming its fibers, so
// a build that awaited a request's I/O would hang every later request for the
// isolate's life. Here the build runs synchronously, and a layer that awaits a
// promise or a timer while built throws where the handler is made.
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

export class RouterBuildAwaited extends Data.TaggedError("RouterBuildAwaited")<{
  readonly message: string;
}> {}

type RequestNeeds<A, R> = Exclude<
  | HttpRouter.Request.Only<"Requires", R>
  | HttpRouter.Request.Only<"GlobalRequires", R>,
  A | Scope.Scope | HttpServerRequest.HttpServerRequest
>;

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

  // `runSyncExit`'s own scheduler would ride along in any context a layer captures
  // while built, so the build runs on the default one; `runSyncExit` still drains what
  // it schedules before it returns.
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

  const handler = (
    request: Request,
    context?: Context.Context<RequestNeeds<A, R>>
  ): Promise<Response> => serveRequest(request, context);

  return {
    dispose: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    handler,
  };
};
