/**
 * The Lander: the trusted container that merges answers, composes ask files,
 * lands checked trees on canonical `main` with a non-force push, and bundles
 * the config folder (spec §4.3). It runs no answer's code. A stub until W3
 * 306 builds it: every job is `VerifierBlocked`. The class name is frozen.
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
import { VerifierBlocked } from "@repo/protocol/refusal";
import { DurableObject } from "cloudflare:workers";

import { answerJob, notBuilt } from "./job.ts";

/** The Lander's Durable Object, which owns its container. */
export class Lander extends DurableObject<Env> {}

/** An answer's head merged onto canonical `main`. */
export const runMerge = (
  _env: Env,
  wire: typeof MergeWire.Encoded
): Promise<typeof MergeExit.Encoded> =>
  answerJob(MergeWire, MergeExit, () =>
    notBuilt("merge", new VerifierBlocked({}))
  )(wire);

/** A checked tree landed on canonical `main`. */
export const runLand = (
  _env: Env,
  wire: typeof LandWire.Encoded
): Promise<typeof LandExit.Encoded> =>
  answerJob(LandWire, LandExit, () =>
    notBuilt("land", new VerifierBlocked({}))
  )(wire);

/** A decider's files composed onto canonical `main`, on a compose ref. */
export const runCompose = (
  _env: Env,
  wire: typeof ComposeWire.Encoded
): Promise<typeof ComposeExit.Encoded> =>
  answerJob(ComposeWire, ComposeExit, () =>
    notBuilt("compose", new VerifierBlocked({}))
  )(wire);

/** The config folder at a landed commit, bundled for the rules evaluator. */
export const runBundleRules = (
  _env: Env,
  wire: typeof BundleWire.Encoded
): Promise<typeof BundleExit.Encoded> =>
  answerJob(BundleWire, BundleExit, () =>
    notBuilt("bundleRules", new VerifierBlocked({}))
  )(wire);
