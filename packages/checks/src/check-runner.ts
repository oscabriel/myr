/**
 * The `CheckRunner` port (spec §4.2): the one way the platform and the CLI run
 * a project's lanes on a tree. `CheckJob` and `CheckRun` are schemas because
 * they cross the sandbox's entrypoint in W3, decoded on both sides.
 * Adapters: `/memory` (scripted, for tests) and `/local` (real processes in a
 * checkout, for the CLI's `check`); the Checker's lives in `apps/platform`.
 */
import { HeldBackResult, LaneResult } from "@repo/protocol/domain/answer";
import { EnvItem } from "@repo/protocol/domain/env";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  AreaName,
  CommitSha,
  EnvKey,
  LaneName,
  ProjectName,
  RepoName,
  SuiteRoot,
  TreeSha,
} from "@repo/protocol/ids";
import type { VerifierBlocked } from "@repo/protocol/refusal";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import { diagnose, Diagnosis } from "./classify.ts";
import type { RunExit } from "./classify.ts";

/**
 * What a job runs on: an exact tree (an answer merged onto main) or a
 * commit (main itself, when an ask opens).
 */
export const CheckAt = Schema.TaggedUnion({
  Commit: { commit: CommitSha },
  Tree: { tree: TreeSha },
});

export type CheckAt = typeof CheckAt.Type;

/** The object id a job runs on, whichever kind it is. */
export const shaOf = (at: CheckAt): string =>
  CheckAt.match(at, {
    Commit: ({ commit }): string => commit,
    Tree: ({ tree }): string => tree,
  });

/**
 * One lane to run: its name, the project's command for it, and its time
 * limit. A lane with `output: "stdout"` is a count (a lint rule's or a
 * ratchet's), read from what its command prints: the run hands its stdout
 * back in `CheckRun.outputs`, to the platform alone, never to an answerer.
 */
export const CheckLane = Schema.Struct({
  command: Schema.NonEmptyString,
  lane: LaneName,
  output: Schema.optionalKey(Schema.Literal("stdout")),
  timeoutMs: Schema.optionalKey(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))
  ),
});

export type CheckLane = typeof CheckLane.Type;

/** A request to run lanes on one tree of one project's repo. */
export const CheckJob = Schema.Struct({
  at: CheckAt,
  /** The sealed suite, from the layer's repo at its pinned commit (W6). */
  heldBack: Schema.optionalKey(
    Schema.Struct({
      areas: Schema.Array(AreaName),
      at: CommitSha,
      layerRepo: RepoName,
      suite: SuiteRoot,
    })
  ),
  lanes: Schema.Array(CheckLane),
  /** Env items whose values the run sees only as placeholders. */
  placeholders: Schema.Array(EnvKey),
  project: ProjectName,
  /** Env items whose outbound hosts go through the platform's gateway. */
  proxies: Schema.Array(EnvItem),
  repo: RepoName,
  /**
   * The project's run block at the policy the job was made under: how the
   * Checker sets up (`setup`, `setupEgress`, `image`). The Checker never
   * guesses a project's setup.
   */
  run: RunBlock,
});

export type CheckJob = typeof CheckJob.Type;

/**
 * What a lane that did not pass leaves for comparing runs without logs: its
 * failure signature when it failed on assertions, and `no assertion` when it
 * found no tests at all.
 */
export const LaneEvidence = Schema.Struct({
  lane: LaneName,
  signature: Schema.optionalKey(Schema.NonEmptyString),
  weakness: Schema.optionalKey(Schema.Literal("no assertion")),
});

export type LaneEvidence = typeof LaneEvidence.Type;

/** A lane's evidence, read from its exit where the run happened. */
export const evidenceFrom = (lane: LaneName, exit: RunExit): LaneEvidence =>
  Diagnosis.$match(diagnose(exit), {
    Blocked: () => ({ lane }),
    Failed: ({ signature }) =>
      Option.match(signature, {
        onNone: () => ({ lane }),
        onSome: (text) => ({ lane, signature: text }),
      }),
    LoadError: () => ({ lane }),
    NoTests: () => ({ lane, weakness: "no assertion" as const }),
    Passed: () => ({ lane }),
  });

/** What a count lane printed: the stdout its count is read from. */
export const LaneOutput = Schema.Struct({
  lane: LaneName,
  stdout: Schema.String,
});

export type LaneOutput = typeof LaneOutput.Type;

/**
 * One job's result: each lane, the held-back areas' bits, the whole run's
 * time, and the evidence of every lane that did not pass. Logs never travel
 * here; a lane's `logRef` names where the platform keeps its log. A count
 * lane's stdout does, in `outputs` (one per lane that asked for it), since
 * its count is read from it.
 */
export const CheckRun = Schema.Struct({
  durationMs: Schema.Int,
  evidence: Schema.Array(LaneEvidence),
  heldBack: Schema.Array(HeldBackResult),
  lanes: Schema.Array(LaneResult),
  outputs: Schema.optionalKey(Schema.Array(LaneOutput)),
});

export type CheckRun = typeof CheckRun.Type;

/** What a count lane of `run` printed; none when the lane did not ask for it, or did not run. */
export const outputOf = (
  run: CheckRun,
  lane: LaneName
): Option.Option<string> =>
  Option.map(
    Option.fromUndefinedOr(run.outputs?.find((each) => each.lane === lane)),
    ({ stdout }) => stdout
  );

/**
 * Runs a job's lanes. `VerifierBlocked` means the run could not happen at all
 * (no checkout, no script for it): the gate's trouble, never the answer's.
 */
export class CheckRunner extends Context.Service<
  CheckRunner,
  {
    readonly run: (job: CheckJob) => Effect.Effect<CheckRun, VerifierBlocked>;
  }
>()("checks/CheckRunner") {}
