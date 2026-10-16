import { Effect, Predicate } from "effect";

/**
 * Workers RPC puts a `Symbol.dispose` on every object a call returns. Where
 * the far side's own result carried a disposer, its call stays open until
 * that is called, and a result left to the garbage collector draws the
 * runtime's "An RPC result was not disposed properly". Every result here is
 * data, whole once it arrives, so each is disposed as soon as it lands; on a
 * result with nothing to release, disposing does nothing.
 */
export const disposed = <A>(result: A): Effect.Effect<A> =>
  Effect.try(() => {
    const dispose = Predicate.hasProperty(result, Symbol.dispose)
      ? result[Symbol.dispose]
      : undefined;

    if (Predicate.isFunction(dispose)) {
      dispose.call(result);
    }
  }).pipe(Effect.ignore, Effect.as(result));

/**
 * A Durable Object's reply, to be returned from the sandbox's own RPC method.
 * Passed on as it came, it would carry the disposer the runtime gave it, so
 * the platform's call would stay open until the platform disposed of it. The
 * reply is copied instead (a structured clone keeps no symbol-keyed
 * property), and disposed here.
 */
export const passedOn = <X>(call: () => Promise<X>): Promise<X> =>
  Effect.runPromise(
    Effect.promise(call).pipe(
      Effect.flatMap((reply) =>
        Effect.sync(() => structuredClone(reply)).pipe(
          Effect.ensuring(disposed(reply))
        )
      )
    )
  );
