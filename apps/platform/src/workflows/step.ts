import { Context, Effect, Layer, Option, Ref, Schema } from "effect";

export interface WorkflowStepRetries {
  readonly limit: number;
  readonly delay: number;
  readonly backoff: "constant" | "linear" | "exponential";
}

export interface WorkflowSteps {
  readonly do: (
    name: string,
    config: { readonly retries?: WorkflowStepRetries },
    body: () => Promise<Schema.Json>
  ) => Promise<Schema.Json>;
}

export interface StepRetry {
  readonly limit: number;
  readonly delayMs: number;
  readonly backoff: "constant" | "linear" | "exponential";
}

export class StepRunner extends Context.Service<
  StepRunner,
  {
    // A replay of a spent step dies: the engine keeps only an error, not the typed
    // failure, so a program that must survive one records its outcome as a value.
    readonly step: <A, I, E, R>(
      name: string,
      schema: Schema.Codec<A, I>,
      effect: Effect.Effect<A, E, R>,
      retry?: StepRetry
    ) => Effect.Effect<A, E, R>;
  }
>()("platform/StepRunner") {}

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

export const workflowSteps = (steps: WorkflowSteps): Layer.Layer<StepRunner> =>
  Layer.succeed(StepRunner, StepRunner.of({ step: durableStep(steps) }));

interface MemoRecords {
  readonly values: Ref.Ref<ReadonlyMap<string, Schema.Json>>;
  readonly failures: Ref.Ref<ReadonlyMap<string, unknown>>;
}

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
      // it, and no process in a replay saw the typed failure.
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

export const memoSteps = (): Effect.Effect<Layer.Layer<StepRunner>> =>
  Effect.map(
    Effect.all({
      failures: Ref.make<ReadonlyMap<string, unknown>>(new Map()),
      values: Ref.make<ReadonlyMap<string, Schema.Json>>(new Map()),
    }),
    (records) =>
      Layer.succeed(StepRunner, StepRunner.of({ step: memoStep(records) }))
  );
