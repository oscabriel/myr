// The trusted container: it runs no answer's code, only git and bun's bundler
// with macros off. One per project, one job at a time, so landings stay serial.
import {
  BundleExit,
  BundleWire,
  ComposeExit,
  ComposeWire,
  LandExit,
  LandWire,
  MergeExit,
  MergeWire,
} from "@repo/project/lander/wire";
import { DurableObject } from "cloudflare:workers";
import { Effect, Semaphore } from "effect";
import type { Layer } from "effect";

import type { Box } from "./box.ts";
import { SdkBox } from "./box/sdk.ts";
import { answerJob } from "./job.ts";
import { bundleRules, compose, land, merge } from "./lander/run.ts";

export const landImage = "land";

export const landerJobs = (
  box: Layer.Layer<Box>,
  turn: Semaphore.Semaphore
) => {
  const inBox = <A, E>(job: Effect.Effect<A, E, Box>) =>
    job.pipe(Effect.provide(box), Semaphore.withPermit(turn));

  return {
    bundleRules: answerJob(BundleWire, BundleExit, (wire) =>
      inBox(bundleRules(wire))
    ),
    compose: answerJob(ComposeWire, ComposeExit, (wire) =>
      inBox(compose(wire))
    ),
    land: answerJob(LandWire, LandExit, (wire) => inBox(land(wire))),
    merge: answerJob(MergeWire, MergeExit, (wire) => inBox(merge(wire))),
  };
};

/** On the default `lite` (1/16 vCPU) one landing took 32 s. */
export const landInstance = "standard-2";

/** Internet on: git reaches Artifacts over HTTPS with each job's tokens. */
export class Lander extends DurableObject<Env> {
  readonly #jobs: ReturnType<typeof landerJobs>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const { container } = ctx;

    if (container === undefined) {
      throw new TypeError("the Lander's Durable Object has no container");
    }

    this.#jobs = landerJobs(
      SdkBox.layer(container, {
        enableInternet: true,
        image: container.images[landImage] ?? landImage,
        instance: landInstance,
      }),
      Semaphore.makeUnsafe(1)
    );
  }

  merge(wire: typeof MergeWire.Encoded): Promise<typeof MergeExit.Encoded> {
    return this.#jobs.merge(wire);
  }

  land(wire: typeof LandWire.Encoded): Promise<typeof LandExit.Encoded> {
    return this.#jobs.land(wire);
  }

  compose(
    wire: typeof ComposeWire.Encoded
  ): Promise<typeof ComposeExit.Encoded> {
    return this.#jobs.compose(wire);
  }

  bundleRules(
    wire: typeof BundleWire.Encoded
  ): Promise<typeof BundleExit.Encoded> {
    return this.#jobs.bundleRules(wire);
  }
}

export type LanderJobs = Pick<
  Lander,
  "bundleRules" | "compose" | "land" | "merge"
>;

// The generated `Env` names the class through an `import()` the type-aware
// linter does not follow, so a stub read straight from `Env` would be `any`.
export interface Landers {
  readonly LANDER: { readonly getByName: (name: string) => LanderJobs };
}

const landerOf = (
  env: Landers,
  wire: { readonly job: { readonly repo: string } }
) => env.LANDER.getByName(wire.job.repo);

export const runMerge = (
  env: Landers,
  wire: typeof MergeWire.Encoded
): Promise<typeof MergeExit.Encoded> => landerOf(env, wire).merge(wire);

export const runLand = (
  env: Landers,
  wire: typeof LandWire.Encoded
): Promise<typeof LandExit.Encoded> => landerOf(env, wire).land(wire);

export const runCompose = (
  env: Landers,
  wire: typeof ComposeWire.Encoded
): Promise<typeof ComposeExit.Encoded> => landerOf(env, wire).compose(wire);

export const runBundleRules = (
  env: Landers,
  wire: typeof BundleWire.Encoded
): Promise<typeof BundleExit.Encoded> => landerOf(env, wire).bundleRules(wire);
