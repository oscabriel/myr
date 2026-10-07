/**
 * The Lander: the trusted container that merges answers, composes ask files,
 * lands checked trees on canonical `main` with a non-force push, and bundles
 * the config folder (spec §4.3). It runs no answer's code: only git, and
 * bun's bundler with macros off. The class name is frozen.
 *
 * One Lander Durable Object per project, named by the project's canonical
 * repo, owns one container and runs one job at a time in it: its jobs share
 * the container's copy of the repo and its scratch files, and a project's
 * landings stay serial here as they are in the Project DO's queue.
 */
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

/** The image the Lander's container runs: `images.land` in `wrangler.jsonc`. */
export const landImage = "land";

/**
 * The Lander's four jobs as the service binding carries them: each decoded,
 * run in `box` while it holds `turn` (one job at a time), and its `Exit`
 * encoded as JSON.
 */
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

/**
 * The Lander's Durable Object, which owns its container: started on its
 * first job from the `land` image, with internet on, since git reaches
 * Artifacts over HTTPS with the tokens each job carries.
 */
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

/** The Lander's jobs as its Durable Object takes them over RPC. */
export type LanderJobs = Pick<
  Lander,
  "bundleRules" | "compose" | "land" | "merge"
>;

/**
 * The one binding the jobs reach: the Lander namespace, by what it gives.
 * The Worker's `Env` is one; so is a test's fake. (The generated `Env` names
 * the class through an `import()` the type-aware linter does not follow, so
 * it would read a stub straight from `Env` as `any`.)
 */
export interface Landers {
  readonly LANDER: { readonly getByName: (name: string) => LanderJobs };
}

/** The project's Lander: one per canonical repo, so one container per project. */
const landerOf = (
  env: Landers,
  wire: { readonly job: { readonly repo: string } }
) => env.LANDER.getByName(wire.job.repo);

/** An answer's head merged onto canonical `main`, in the project's Lander. */
export const runMerge = (
  env: Landers,
  wire: typeof MergeWire.Encoded
): Promise<typeof MergeExit.Encoded> => landerOf(env, wire).merge(wire);

/** A checked tree landed on canonical `main`, in the project's Lander. */
export const runLand = (
  env: Landers,
  wire: typeof LandWire.Encoded
): Promise<typeof LandExit.Encoded> => landerOf(env, wire).land(wire);

/** A decider's files composed onto canonical `main`, on a compose ref. */
export const runCompose = (
  env: Landers,
  wire: typeof ComposeWire.Encoded
): Promise<typeof ComposeExit.Encoded> => landerOf(env, wire).compose(wire);

/** The config folder at a landed commit, bundled for the rules evaluator. */
export const runBundleRules = (
  env: Landers,
  wire: typeof BundleWire.Encoded
): Promise<typeof BundleExit.Encoded> => landerOf(env, wire).bundleRules(wire);
