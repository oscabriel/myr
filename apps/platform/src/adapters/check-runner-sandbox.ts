import { RepoHost } from "@repo/artifacts/repo-host";
import { CheckRunner } from "@repo/checks/check-runner";
import type { CheckJob, CheckRun } from "@repo/checks/check-runner";
import { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
import type {
  BundleExit,
  BundleWire,
  ComposeExit,
  ComposeWire,
  LandExit,
  LandWire,
  MergeExit,
  MergeWire,
} from "@repo/project/lander/wire";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { Array, Effect, Layer } from "effect";

import { sandboxJob, withRemote } from "./sandbox-credentials.ts";

export interface SandboxBinding {
  readonly check: (
    wire: typeof CheckWire.Encoded
  ) => Promise<typeof CheckExit.Encoded>;
  readonly merge: (
    wire: typeof MergeWire.Encoded
  ) => Promise<typeof MergeExit.Encoded>;
  readonly land: (
    wire: typeof LandWire.Encoded
  ) => Promise<typeof LandExit.Encoded>;
  readonly compose: (
    wire: typeof ComposeWire.Encoded
  ) => Promise<typeof ComposeExit.Encoded>;
  readonly bundleRules: (
    wire: typeof BundleWire.Encoded
  ) => Promise<typeof BundleExit.Encoded>;
}

// Bits that answer some other job are the platform's trouble, never a result an answer earned.
const answersJob = (job: CheckJob, bits: readonly HeldBackResult[]) => {
  const suite = job.heldBack;

  if (suite === undefined) {
    return bits.length === 0;
  }

  const areas = Array.dedupe(suite.areas);

  return (
    bits.length === areas.length &&
    areas.every((area, index) => {
      const each = bits[index];
      const total = suite.runs.filter((run) => run.area === area).length;

      return (
        each !== undefined &&
        each.area === area &&
        each.suite === suite.suite &&
        each.total === total &&
        each.passed >= 0 &&
        each.passed <= total
      );
    })
  );
};

const heldTo = (job: CheckJob) => (ran: CheckRun) =>
  answersJob(job, ran.heldBack)
    ? Effect.succeed(ran)
    : Effect.logError("sandbox job blocked").pipe(
        Effect.annotateLogs({
          failure: "held-back bits do not answer the job",
          method: "check",
        }),
        Effect.andThen(Effect.fail(new VerifierBlocked({})))
      );

export const CheckRunnerSandbox = (
  sandbox: SandboxBinding
): Layer.Layer<CheckRunner, never, RepoHost> =>
  Layer.effect(
    CheckRunner,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return CheckRunner.of({
        run: (job) =>
          withRemote("check", { repo: job.repo, scope: "read" }, (clone) =>
            sandboxJob({
              exit: CheckExit,
              job: { clone, job },
              method: "check",
              remotes: [clone],
              send: (wire) => sandbox.check(wire),
              wire: CheckWire,
            })
          ).pipe(
            Effect.flatMap(heldTo(job)),
            Effect.provideService(RepoHost, host)
          ),
      });
    })
  );
