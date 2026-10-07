/**
 * `Lander` from a script, for tests: each operation returns its scripted
 * results in order, and the last one again once they run out. An operation
 * with no script is `VerifierBlocked`, as a Lander that cannot run is. It
 * records every job it is given, in order, for the test to read back.
 */
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

/** One call the scripted Lander answered, with the job it was given. */
export type LanderJob = Data.TaggedEnum<{
  Merge: { readonly job: MergeJob };
  Land: { readonly job: LandJob };
  Compose: { readonly job: ComposeJob };
  BundleRules: { readonly job: BundleJob };
}>;

export const LanderJob = Data.taggedEnum<LanderJob>();

/** Each operation's results, in the order its calls get them. */
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

/** A scripted Lander, and the jobs it has been given so far. */
export type ScriptedLander = Layer.Layer<Lander> & {
  readonly jobs: Effect.Effect<readonly LanderJob[]>;
};

export const LanderMemory = {
  /**
   * One scripted Lander: every build of the layer shares its script's place
   * and its record of jobs, so a test reads `jobs` after providing it.
   */
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
