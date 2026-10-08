/**
 * The `CheckRunner` port: the one way the platform and the CLI run
 * a project's lanes on a tree. `CheckJob` and `CheckRun` are schemas because
 * they cross the sandbox's entrypoint, decoded on both sides.
 * Adapters: `/memory` (scripted, for tests) and `/local` (real processes in a
 * checkout, for the CLI's `check`); the Checker's lives in `apps/platform`.
 */
import { HeldBackResult, LaneResult } from "@repo/protocol/domain/answer";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  AreaName,
  CommitSha,
  EnvKey,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
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

/**
 * One sealed file, as the platform read it from the layer at the pinned
 * commit: its path in the checked tree, its area, and its bytes. On the
 * wire the bytes are base64 (`contentBase64`), decoded to bytes where the
 * job is decoded, before the Checker writes them.
 */
export const HeldBackFile = Schema.Struct({
  area: AreaName,
  content: Schema.Uint8ArrayFromBase64,
  path: RepoPath,
}).pipe(Schema.encodeKeys({ content: "contentBase64" }));

export type HeldBackFile = typeof HeldBackFile.Type;

/** One sealed check to run: its area, its file, and the command that runs it. */
export const HeldBackCheck = Schema.Struct({
  area: AreaName,
  command: Schema.NonEmptyString,
  path: RepoPath,
});

export type HeldBackCheck = typeof HeldBackCheck.Type;

/**
 * A sealed suite's part of a job: the layer's files
 * under the sealed areas and one run per sealed check, all read by the
 * platform at the commit the claim was pinned to. No layer repo, route or
 * token is named: the sandbox never reaches the layer.
 */
export const HeldBackPart = Schema.Struct({
  areas: Schema.Array(AreaName),
  /** The layer commit the suite was pinned at. */
  at: CommitSha,
  files: Schema.Array(HeldBackFile),
  runs: Schema.Array(HeldBackCheck),
  suite: SuiteRoot,
});

export type HeldBackPart = typeof HeldBackPart.Type;

/**
 * What a run sees in place of one write-only value: its item's key, set in
 * every command's env to the placeholder. The platform makes
 * the placeholder (`@repo/visibility/proxy`'s `placeholderFor`); the sandbox
 * only sets it.
 */
export const EnvPlaceholder = Schema.Struct({
  key: EnvKey,
  placeholder: Schema.NonEmptyString,
});

export type EnvPlaceholder = typeof EnvPlaceholder.Type;

/**
 * One outbound host of a `@proxy` item, as `@repo/visibility/proxy`'s
 * `ProxyRule` crosses the wire: HTTPS requests to `host` (a glob
 * stays one) go through the Checker's env gateway, which lets out only those
 * whose path matches `path` and whose method is `method` (any, when absent),
 * none when `block`, and, in a run of landed code alone, swaps `placeholder`
 * for the value of `key` in the request's headers.
 */
export const EnvProxy = Schema.Struct({
  block: Schema.Boolean,
  host: Schema.NonEmptyString,
  key: EnvKey,
  method: Schema.optionalKey(Schema.NonEmptyString),
  path: Schema.optionalKey(Schema.NonEmptyString),
  placeholder: Schema.NonEmptyString,
});

export type EnvProxy = typeof EnvProxy.Type;

/**
 * One write-only value, opened by the platform for a run of landed code
 * (`ProjectEnv.runEnv(…, landed: true)`). Redacted wherever it is printed;
 * the sandbox hands it only to its env gateway, never to the container.
 */
export const EnvValue = Schema.Struct({
  key: EnvKey,
  value: Schema.RedactedFromValue(Schema.NonEmptyString),
});

export type EnvValue = typeof EnvValue.Type;

/**
 * A request to run lanes on one tree of one project's repo. Only a job of
 * landed code carries values: a job that is not `landed` and carries any
 * does not decode, nor encode.
 */
export const CheckJob = Schema.Struct({
  at: CheckAt,
  /** The sealed suite, from the layer at its pinned commit. */
  heldBack: Schema.optionalKey(HeldBackPart),
  /** Whether the job runs landed code. Absent, it does not. */
  landed: Schema.optionalKey(Schema.Boolean),
  lanes: Schema.Array(CheckLane),
  /** What the run sees, in place of each write-only value. */
  placeholders: Schema.Array(EnvPlaceholder),
  project: ProjectName,
  /** The outbound hosts whose requests go through the platform's env gateway. */
  proxies: Schema.Array(EnvProxy),
  repo: RepoName,
  /**
   * The project's run block at the policy the job was made under: how the
   * Checker sets up (`setup`, `setupEgress`, `image`). The Checker never
   * guesses a project's setup.
   */
  run: RunBlock,
  /** The values the env gateway swaps in, for a job of landed code only. */
  values: Schema.optionalKey(Schema.Array(EnvValue)),
}).check(
  Schema.makeFilter(({ landed, values }) =>
    values === undefined || landed === true
      ? true
      : "only a job of landed code carries values"
  )
);

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
