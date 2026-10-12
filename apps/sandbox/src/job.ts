import { Effect, Schema } from "effect";
import type { Exit } from "effect";

export const answerJob =
  <W, WI, A, E, X>(
    wire: Schema.Codec<W, WI>,
    exit: Schema.Codec<Exit.Exit<A, E>, X>,
    run: (job: W) => Effect.Effect<A, E>
  ) =>
  (encoded: WI): Promise<X> =>
    Effect.runPromise(
      Schema.decodeEffect(wire)(encoded).pipe(
        Effect.orDie,
        Effect.flatMap(run),
        Effect.exit,
        Effect.flatMap((outcome) =>
          Effect.orDie(Schema.encodeEffect(exit)(outcome))
        )
      )
    );

export const notBuilt = <E>(job: string, blocked: E) =>
  Effect.logWarning("sandbox job not built").pipe(
    Effect.annotateLogs({ job, reason: "not built" }),
    Effect.andThen(Effect.fail(blocked))
  );
