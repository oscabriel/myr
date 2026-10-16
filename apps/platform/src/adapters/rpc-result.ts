import { Effect, Predicate } from "effect";

/**
 * Workers RPC puts a `Symbol.dispose` on every object a call returns. Where
 * the far side's own result carried a disposer (an object it had from an RPC
 * call of its own, passed on as it came, is one), its call stays open until
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
