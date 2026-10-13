import { withInvocation } from "@repo/telemetry/spans";
import type { InvocationIds } from "@repo/telemetry/spans";
import type { TelemetryOptions } from "@repo/telemetry/telemetry";
import { Effect, Schema } from "effect";
import type { Exit, Layer, Redacted } from "effect";

import { jobTelemetry } from "./telemetry.ts";

/** A job the platform sends: its wire, its reply and what it shows of itself. */
export interface Job<W, WI, A, E, X> {
  /** Its span: Workers do not trace a container, so this is the trace's view of it. */
  readonly name: string;
  readonly wire: Schema.Codec<W, WI>;
  readonly exit: Schema.Codec<Exit.Exit<A, E>, X>;
  /** What Issues shows beside it: ids only, never a repo or a path. */
  readonly ids: (job: W) => InvocationIds;
  /** The tokens it carries, which nothing it logs or traces may. */
  readonly tokens: (job: W) => readonly Redacted.Redacted[];
  /** What its spans keep of a defect: its name alone where sealed files are near. */
  readonly defects: NonNullable<TelemetryOptions["defects"]>;
}

/** The telemetry a job runs with, given its tokens and what its spans keep of a defect. */
export type JobTelemetry = (
  tokens: readonly Redacted.Redacted[],
  defects: NonNullable<TelemetryOptions["defects"]>
) => Layer.Layer<never>;

// A defect is no report of the sandbox's own: it crosses in the job's Exit,
// and the platform reports it there, once, with the job's tokens scrubbed.
export const answered =
  <W, WI, A, E, X>(
    job: Job<W, WI, A, E, X>,
    run: (wire: W) => Effect.Effect<A, E>,
    telemetry: JobTelemetry = jobTelemetry
  ) =>
  (encoded: WI): Effect.Effect<X> =>
    Schema.decodeEffect(job.wire)(encoded).pipe(
      Effect.orDie,
      Effect.flatMap((decoded) =>
        run(decoded).pipe(
          Effect.withSpan(job.name),
          withInvocation(job.ids(decoded)),
          Effect.provide(telemetry(job.tokens(decoded), job.defects))
        )
      ),
      Effect.exit,
      Effect.flatMap((outcome) =>
        Effect.orDie(Schema.encodeEffect(job.exit)(outcome))
      )
    );

export const answerJob =
  <W, WI, A, E, X>(
    job: Job<W, WI, A, E, X>,
    run: (wire: W) => Effect.Effect<A, E>
  ) =>
  (encoded: WI): Promise<X> =>
    Effect.runPromise(answered(job, run)(encoded));

export const notBuilt = <E>(job: string, blocked: E) =>
  Effect.logWarning("sandbox job not built").pipe(
    Effect.annotateLogs({ job, reason: "not built" }),
    Effect.andThen(Effect.fail(blocked))
  );
