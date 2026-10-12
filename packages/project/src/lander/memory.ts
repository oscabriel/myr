import type { RepoBusy, StaleBase } from "@repo/protocol/refusal";
import { VerifierBlocked } from "@repo/protocol/refusal";
import type { ConfigBundle } from "@repo/rules/rules-evaluator";
import { Array, Data, Effect, Layer } from "effect";
import type { Result } from "effect";

import { Lander } from "../lander.ts";
import type {
  BundleJob,
  ComposeJob,
  Composed,
  Landed,
  LandJob,
  MergeJob,
  Merged,
} from "../lander.ts";

export type LanderJob = Data.TaggedEnum<{
  Merge: { readonly job: MergeJob };
  Land: { readonly job: LandJob };
  Compose: { readonly job: ComposeJob };
  BundleRules: { readonly job: BundleJob };
}>;

export const LanderJob = Data.taggedEnum<LanderJob>();

export interface LanderScript {
  readonly merge?: readonly Result.Result<
    Merged,
    StaleBase | VerifierBlocked
  >[];
  readonly land?: readonly Result.Result<
    Landed,
    StaleBase | RepoBusy | VerifierBlocked
  >[];
  readonly compose?: readonly Result.Result<Composed, VerifierBlocked>[];
  readonly bundle?: readonly Result.Result<ConfigBundle, VerifierBlocked>[];
}

export type ScriptedLander = Layer.Layer<Lander> & {
  readonly jobs: Effect.Effect<readonly LanderJob[]>;
};

export const LanderMemory = {
  layer: (script: LanderScript): ScriptedLander => {
    const jobs: LanderJob[] = [];
    const served = new Map<keyof LanderScript, number>();

    const answer = <A, E>(
      operation: keyof LanderScript,
      results: readonly Result.Result<A, E>[] | undefined,
      job: LanderJob
    ): Effect.Effect<A, E | VerifierBlocked> =>
      Effect.suspend((): Effect.Effect<A, E | VerifierBlocked> => {
        const count = served.get(operation) ?? 0;

        jobs.push(job);
        served.set(operation, count + 1);

        if (results === undefined || !Array.isReadonlyArrayNonEmpty(results)) {
          return Effect.fail(new VerifierBlocked({}));
        }

        return Effect.fromResult(
          results[Math.min(count, results.length - 1)] ?? results[0]
        );
      });

    const layer = Layer.succeed(Lander, {
      bundleRules: (job) =>
        answer("bundle", script.bundle, LanderJob.BundleRules({ job })),
      compose: (job) =>
        answer("compose", script.compose, LanderJob.Compose({ job })),
      land: (job) => answer("land", script.land, LanderJob.Land({ job })),
      merge: (job) => answer("merge", script.merge, LanderJob.Merge({ job })),
    });

    return Object.assign(layer, { jobs: Effect.sync(() => [...jobs]) });
  },
};
