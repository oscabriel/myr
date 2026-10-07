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
     * engine's default without one), records no value, and, once the
     * retries are spent, fails the step with the last failure. A replay of
     * a spent step dies: the engine keeps only an error, not the typed
     * failure, so a program that must survive one records its outcome as a
     * value in a step of its own (OnPush's `settle`).
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

/** What the in-memory steps keep per name: a step's value, or its last failure. */
interface MemoRecords {
  readonly values: Ref.Ref<ReadonlyMap<string, Schema.Json>>;
  readonly failures: Ref.Ref<ReadonlyMap<string, unknown>>;
}

/** One step over an in-memory record of steps, keyed by name. */
const memoStep =
  ({ failures, values }: MemoRecords) =>
  <A, I, E, R>(
    name: string,
    schema: Schema.Codec<A, I>,
    effect: Effect.Effect<A, E, R>,
    retry?: StepRetry
  ): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const json = Schema.toCodecJson(schema);
      const kept = (yield* Ref.get(values)).get(name);

      if (kept !== undefined) {
        return yield* Effect.orDie(Schema.decodeEffect(json)(kept));
      }

      // The engine throws a spent step's kept failure again without running
      // it, and no process in a replay saw the typed failure (W3 313 #8).
      const spent = (yield* Ref.get(failures)).get(name);

      if (spent !== undefined) {
        return yield* Effect.die(spent);
      }

      const value = yield* Effect.retry(effect, {
        times: retry?.limit ?? 0,
      }).pipe(
        Effect.tapError((failure) =>
          Ref.update(failures, (all) => new Map(all).set(name, failure))
        )
      );

      const encoded = yield* Effect.orDie(Schema.encodeEffect(json)(value));

      yield* Ref.update(values, (all) => new Map(all).set(name, encoded));

      return yield* Effect.orDie(Schema.decodeEffect(json)(encoded));
    });

/**
 * Steps in memory, for tests, replaying as the engine does: the layer keeps
 * one record per step name for as long as the returned layer lives, so
 * running a program twice over it replays the second time. A failed step is
 * retried up to its limit, without waiting; once its retries are spent it
 * fails with its last failure, and a replay dies without running it, as a
 * replay over `workflowSteps` does when the engine throws the failure it
 * kept.
 */
export const memoSteps = (): Effect.Effect<Layer.Layer<StepRunner>> =>
  Effect.map(
    Effect.all({
      failures: Ref.make<ReadonlyMap<string, unknown>>(new Map()),
      values: Ref.make<ReadonlyMap<string, Schema.Json>>(new Map()),
    }),
    (records) =>
      Layer.succeed(StepRunner, StepRunner.of({ step: memoStep(records) }))
  );
