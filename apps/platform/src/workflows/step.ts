/**
 * The seam between Effect programs and a Workflow's durable steps, shared by
 * the Answer (W3 304) and OnPush (313) Workflows. A program names each step
 * and gives the schema of its value; over a Workflow, the engine records the
 * value encoded as JSON and a replay decodes the record instead of running
 * the step again (principle 8).
 */
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";

/** How the engine retries a step that failed: as `WorkflowStepConfig` spells it. */
export interface WorkflowStepRetries {
  readonly limit: number;
  readonly delay: number;
  readonly backoff: "constant" | "linear" | "exponential";
}

/**
 * The part of a Workflow's `WorkflowStep` this seam uses: `do`, with a
 * config, recording what its body returns. A `WorkflowStep` is one.
 */
export interface WorkflowSteps {
  readonly do: (
    name: string,
    config: { readonly retries?: WorkflowStepRetries },
    body: () => Promise<Schema.Json>
  ) => Promise<Schema.Json>;
}

/** How often, and how far apart, a failed step runs again before the run fails. */
export interface StepRetry {
  readonly limit: number;
  readonly delayMs: number;
  readonly backoff: "constant" | "linear" | "exponential";
}

export class StepRunner extends Context.Service<
  StepRunner,
  {
    /**
     * Runs `effect` once per (instance, name); a replay returns the recorded
     * value, decoded with `schema`. A failure is retried per `retry` (the
     * engine's default without one), records nothing, and, once the retries
     * are spent, fails the step with the last failure.
     */
    readonly step: <A, I, E, R>(
      name: string,
      schema: Schema.Codec<A, I>,
      effect: Effect.Effect<A, E, R>,
      retry?: StepRetry
    ) => Effect.Effect<A, E, R>;
  }
>()("platform/StepRunner") {}

/** The engine's spelling of a step's retries. */
const configOf = (retry: StepRetry | undefined) =>
  retry === undefined
    ? {}
    : {
        retries: {
          backoff: retry.backoff,
          delay: retry.delayMs,
          limit: retry.limit,
        },
      };

/** One step over a Workflow's own steps. */
const durableStep =
  (steps: WorkflowSteps) =>
  <A, I, E, R>(
    name: string,
    schema: Schema.Codec<A, I>,
    effect: Effect.Effect<A, E, R>,
    retry?: StepRetry
  ): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const json = Schema.toCodecJson(schema);
      const context = yield* Effect.context<R>();
      const failed = yield* Ref.make(Option.none<E>());

      const run = effect.pipe(
        Effect.tapError((failure) => Ref.set(failed, Option.some(failure))),
        Effect.flatMap((value) =>
          Effect.orDie(Schema.encodeEffect(json)(value))
        )
      );

      const recorded = yield* Effect.tryPromise(() =>
        steps.do(name, configOf(retry), () =>
          Effect.runPromiseWith(context)(run)
        )
      ).pipe(
        // The engine gave up: the step's own last failure, if it had one.
        Effect.catch((error) =>
          Effect.flatMap(Ref.get(failed), (last) =>
            Option.match(last, {
              onNone: () => Effect.die(error),
              onSome: (failure) => Effect.fail(failure),
            })
          )
        )
      );

      return yield* Effect.orDie(Schema.decodeEffect(json)(recorded));
    });

/**
 * Steps over a Workflow's own: the value goes out encoded as JSON, and comes
 * back decoded, whether the step ran now or is a replay.
 */
export const workflowSteps = (steps: WorkflowSteps): Layer.Layer<StepRunner> =>
  Layer.succeed(StepRunner, StepRunner.of({ step: durableStep(steps) }));

/** One step over an in-memory record of steps, keyed by name. */
const memoStep =
  (records: Ref.Ref<ReadonlyMap<string, Schema.Json>>) =>
  <A, I, E, R>(
    name: string,
    schema: Schema.Codec<A, I>,
    effect: Effect.Effect<A, E, R>,
    retry?: StepRetry
  ): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const json = Schema.toCodecJson(schema);
      const kept = (yield* Ref.get(records)).get(name);

      if (kept !== undefined) {
        return yield* Effect.orDie(Schema.decodeEffect(json)(kept));
      }

      const value = yield* Effect.retry(effect, { times: retry?.limit ?? 0 });
      const encoded = yield* Effect.orDie(Schema.encodeEffect(json)(value));

      yield* Ref.update(records, (all) => new Map(all).set(name, encoded));

      return yield* Effect.orDie(Schema.decodeEffect(json)(encoded));
    });

/**
 * Steps in memory, for tests: the layer keeps one record per step name for
 * as long as the returned layer lives, so running a program twice over it
 * replays the second time. A failed step records nothing and is retried up
 * to its limit, without waiting.
 */
export const memoSteps = (): Effect.Effect<Layer.Layer<StepRunner>> =>
  Effect.map(Ref.make<ReadonlyMap<string, Schema.Json>>(new Map()), (records) =>
    Layer.succeed(StepRunner, StepRunner.of({ step: memoStep(records) }))
  );
