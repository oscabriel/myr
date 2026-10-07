/**
 * How the sandbox answers one job from the platform: decode its wire, run
 * it, and send back its `Exit` encoded as JSON (principle 2: both sides of
 * the service binding decode with the same schemas). A wire that does not
 * decode, or an outcome that does not encode, is a defect: the platform
 * encoded the job with the same schema.
 */
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

/**
 * A job whose side of the sandbox is not built yet: `VerifierBlocked`, the
 * gate's trouble and never the answer's, with `not built` in a log
 * annotation, since a refusal carries no free text (principle 3).
 */
export const notBuilt = <E>(job: string, blocked: E) =>
  Effect.logWarning("sandbox job not built").pipe(
    Effect.annotateLogs({ job, reason: "not built" }),
    Effect.andThen(Effect.fail(blocked))
  );
