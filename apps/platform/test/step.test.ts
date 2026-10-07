import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { LandedSha } from "@repo/protocol/ids";
import { StaleBase } from "@repo/protocol/refusal";
import type { WorkflowStep } from "cloudflare:workers";
import { DateTime, Effect, Option, Ref, Schema } from "effect";

import { memoSteps, StepRunner, workflowSteps } from "../src/workflows/step.ts";
import type {
  WorkflowStepRetries,
  WorkflowSteps,
} from "../src/workflows/step.ts";

const sha = LandedSha.make("a".repeat(40));

/** A value whose encoded form differs from it: a date and an option. */
const Landing = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  sha: Schema.OptionFromOptionalKey(LandedSha),
});

const landing = {
  at: DateTime.makeUnsafe("2026-10-08T12:00:00Z"),
  sha: Option.some(sha),
};

/**
 * A Workflow's steps as the engine runs them, in memory: a step's first run
 * records what its body returns under its name; a replay returns the
 * record without running it. It keeps every retry config it was given.
 */
const fakeWorkflowStep = () => {
  const recorded = new Map<string, Promise<Schema.Json>>();
  const retries: WorkflowStepRetries[] = [];

  const steps: WorkflowSteps = {
    do: (name, config, body) => {
      if (config.retries !== undefined) {
        retries.push(config.retries);
      }

      const kept = recorded.get(name) ?? body();

      recorded.set(name, kept);

      return kept;
    },
  };

  /** What the engine recorded for `name`; `null` if it ran no such step. */
  const record = (name: string) =>
    Effect.promise(() => recorded.get(name) ?? Promise.resolve(null));

  return { record, retries, steps };
};

/** A step that counts its runs and lands. */
const counted = (runs: Ref.Ref<number>) =>
  Effect.as(
    Ref.update(runs, (n) => n + 1),
    landing
  );

describe(StepRunner, () => {
  it("runs over a Workflow's own steps", () => {
    expectTypeOf<WorkflowStep>().toExtend<WorkflowSteps>();
  });

  it.effect("records a step's value encoded, and decodes it back", () =>
    Effect.gen(function* () {
      const fake = fakeWorkflowStep();
      const runs = yield* Ref.make(0);

      const value = yield* StepRunner.use(({ step }) =>
        step("land#1", Landing, counted(runs))
      ).pipe(Effect.provide(workflowSteps(fake.steps)));

      expect(value).toStrictEqual(landing);
      expect(yield* fake.record("land#1")).toStrictEqual({
        at: "2026-10-08T12:00:00.000Z",
        sha,
      });
    })
  );

  it.effect("returns a replayed step's record without running it again", () =>
    Effect.gen(function* () {
      const fake = fakeWorkflowStep();
      const runs = yield* Ref.make(0);

      const run = StepRunner.use(({ step }) =>
        step("land#1", Landing, counted(runs))
      ).pipe(Effect.provide(workflowSteps(fake.steps)));

      expect([yield* run, yield* run]).toStrictEqual([landing, landing]);
      expect(yield* Ref.get(runs)).toBe(1);
    })
  );

  it.effect("hands the engine a step's retries", () =>
    Effect.gen(function* () {
      const fake = fakeWorkflowStep();
      const retry = { backoff: "exponential", delayMs: 500, limit: 3 } as const;

      yield* StepRunner.use(({ step }) =>
        step("merge#1", Landing, Effect.succeed(landing), retry)
      ).pipe(Effect.provide(workflowSteps(fake.steps)));

      expect(fake.retries).toStrictEqual([
        { backoff: "exponential", delay: 500, limit: 3 },
      ]);
    })
  );

  it.effect("fails with a step's own refusal once the engine gives up", () =>
    Effect.gen(function* () {
      const fake = fakeWorkflowStep();
      const stale = new StaleBase({ base: sha, conflicts: [], main: sha });

      const failure = yield* StepRunner.use(({ step }) =>
        step("land#1", Landing, Effect.fail(stale))
      ).pipe(Effect.provide(workflowSteps(fake.steps)), Effect.flip);

      expect(failure).toStrictEqual(stale);
    })
  );
});

describe(memoSteps, () => {
  it.effect("returns the recorded value on a second run", () =>
    Effect.gen(function* () {
      const steps = yield* memoSteps();
      const runs = yield* Ref.make(0);

      const run = StepRunner.use(({ step }) =>
        step("land#1", Landing, counted(runs))
      ).pipe(Effect.provide(steps));

      expect([yield* run, yield* run]).toStrictEqual([landing, landing]);
      expect(yield* Ref.get(runs)).toBe(1);
    })
  );

  it.effect(
    "records nothing for a step that failed, so the next run tries again",
    () =>
      Effect.gen(function* () {
        const steps = yield* memoSteps();
        const runs = yield* Ref.make(0);
        const stale = new StaleBase({ base: sha, conflicts: [], main: sha });

        const failing = StepRunner.use(({ step }) =>
          step(
            "land#1",
            Landing,
            Effect.andThen(
              Ref.update(runs, (n) => n + 1),
              Effect.fail(stale)
            )
          )
        ).pipe(Effect.provide(steps), Effect.flip);

        expect(yield* failing).toStrictEqual(stale);

        const landed = StepRunner.use(({ step }) =>
          step("land#1", Landing, counted(runs))
        ).pipe(Effect.provide(steps));

        expect(yield* landed).toStrictEqual(landing);
        expect(yield* Ref.get(runs)).toBe(2);
      })
  );
});
