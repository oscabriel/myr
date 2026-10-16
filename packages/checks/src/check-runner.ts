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

export const CheckAt = Schema.TaggedUnion({
  Commit: { commit: CommitSha },
  Tree: { tree: TreeSha },
});

export type CheckAt = typeof CheckAt.Type;

export const shaOf = (at: CheckAt): string =>
  CheckAt.match(at, {
    Commit: ({ commit }): string => commit,
    Tree: ({ tree }): string => tree,
  });

// A count lane's stdout goes back to the platform alone, never to an answerer.
export const CheckLane = Schema.Struct({
  command: Schema.NonEmptyString,
  lane: LaneName,
  output: Schema.optionalKey(Schema.Literal("stdout")),
  timeoutMs: Schema.optionalKey(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))
  ),
});

export type CheckLane = typeof CheckLane.Type;

// On the wire the bytes are base64 (`contentBase64`).
export const HeldBackFile = Schema.Struct({
  area: AreaName,
  content: Schema.Uint8ArrayFromBase64,
  path: RepoPath,
}).pipe(Schema.encodeKeys({ content: "contentBase64" }));

export type HeldBackFile = typeof HeldBackFile.Type;

export const HeldBackCheck = Schema.Struct({
  area: AreaName,
  command: Schema.NonEmptyString,
  path: RepoPath,
});

export type HeldBackCheck = typeof HeldBackCheck.Type;

// Names no layer repo, route or token: the sandbox never reaches the layer.
export const HeldBackPart = Schema.Struct({
  areas: Schema.Array(AreaName),
  at: CommitSha,
  files: Schema.Array(HeldBackFile),
  runs: Schema.Array(HeldBackCheck),
  suite: SuiteRoot,
});

export type HeldBackPart = typeof HeldBackPart.Type;

export const EnvPlaceholder = Schema.Struct({
  key: EnvKey,
  placeholder: Schema.NonEmptyString,
});

export type EnvPlaceholder = typeof EnvPlaceholder.Type;

// `placeholder` is swapped for the value of `key` only in a run of landed code.
export const EnvProxy = Schema.Struct({
  block: Schema.Boolean,
  host: Schema.NonEmptyString,
  key: EnvKey,
  method: Schema.optionalKey(Schema.NonEmptyString),
  path: Schema.optionalKey(Schema.NonEmptyString),
  placeholder: Schema.NonEmptyString,
});

export type EnvProxy = typeof EnvProxy.Type;

// The sandbox hands it only to its env gateway, never to the container.
export const EnvValue = Schema.Struct({
  key: EnvKey,
  value: Schema.RedactedFromValue(Schema.NonEmptyString),
});

export type EnvValue = typeof EnvValue.Type;

// A job that is not `landed` and carries values neither decodes nor encodes.
export const CheckJob = Schema.Struct({
  at: CheckAt,
  heldBack: Schema.optionalKey(HeldBackPart),
  landed: Schema.optionalKey(Schema.Boolean),
  lanes: Schema.Array(CheckLane),
  placeholders: Schema.Array(EnvPlaceholder),
  project: ProjectName,
  proxies: Schema.Array(EnvProxy),
  repo: RepoName,
  run: RunBlock,
  values: Schema.optionalKey(Schema.Array(EnvValue)),
}).check(
  Schema.makeFilter(({ landed, values }) =>
    values === undefined || landed === true
      ? true
      : "only a job of landed code carries values"
  )
);

export type CheckJob = typeof CheckJob.Type;

export const LaneEvidence = Schema.Struct({
  lane: LaneName,
  signature: Schema.optionalKey(Schema.NonEmptyString),
  threw: Schema.optionalKey(Schema.NonEmptyString),
  weakness: Schema.optionalKey(Schema.Literal("no assertion")),
});

export type LaneEvidence = typeof LaneEvidence.Type;

export const evidenceFrom = (lane: LaneName, exit: RunExit): LaneEvidence =>
  Diagnosis.$match(diagnose(exit), {
    Blocked: () => ({ lane }),
    Failed: ({ signature, threw }) => ({
      lane,
      ...Option.match(signature, {
        onNone: () => ({}),
        onSome: (text) => ({ signature: text }),
      }),
      ...Option.match(threw, {
        onNone: () => ({}),
        onSome: (text) => ({ threw: text }),
      }),
    }),
    LoadError: () => ({ lane }),
    NoTests: () => ({ lane, weakness: "no assertion" as const }),
    Passed: () => ({ lane }),
  });

export const LaneOutput = Schema.Struct({
  lane: LaneName,
  stdout: Schema.String,
});

export type LaneOutput = typeof LaneOutput.Type;

// Logs never travel here; a lane's `logRef` names where the platform keeps them.
export const CheckRun = Schema.Struct({
  durationMs: Schema.Int,
  evidence: Schema.Array(LaneEvidence),
  heldBack: Schema.Array(HeldBackResult),
  lanes: Schema.Array(LaneResult),
  outputs: Schema.optionalKey(Schema.Array(LaneOutput)),
});

export type CheckRun = typeof CheckRun.Type;

export const outputOf = (
  run: CheckRun,
  lane: LaneName
): Option.Option<string> =>
  Option.map(
    Option.fromUndefinedOr(run.outputs?.find((each) => each.lane === lane)),
    ({ stdout }) => stdout
  );

// `VerifierBlocked` means the run could not happen at all: the gate's
// trouble, never the answer's.
export class CheckRunner extends Context.Service<
  CheckRunner,
  {
    readonly run: (job: CheckJob) => Effect.Effect<CheckRun, VerifierBlocked>;
  }
>()("checks/CheckRunner") {}
