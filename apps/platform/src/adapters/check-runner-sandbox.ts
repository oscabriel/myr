/**
 * `CheckRunner` over the sandbox Worker (spec §4.3): each run goes to the
 * Checker through the `SANDBOX` service binding, with one read token on the
 * repo it clones from and nothing else. The Checker's container never sees
 * the token (W3 315); its outcome comes back as the port's own `CheckRun` or
 * `VerifierBlocked`.
 *
 * A job's sealed suite (W6 605, 613) crosses as the platform read it: the
 * layer's files under the sealed areas, base64 on the wire, and one run per
 * sealed check. No layer repo, route or token goes with it, so the only
 * token is still the one on the answer's fork. Its area bits come back
 * decoded and held to the job that asked for them: one per area the job
 * sent, under the job's suite, each counting that area's checks. Bits that
 * answer some other job are the platform's trouble (`VerifierBlocked`),
 * never a result an answer earned.
 */
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
import { Effect, Layer } from "effect";

import { sandboxJob, withRemote } from "./sandbox-credentials.ts";

/**
 * The sandbox Worker's entrypoint, as the platform reaches it through the
 * `SANDBOX` service binding: each method takes a job's wire, encoded, and
 * answers with the job's `Exit` as JSON, which the adapters decode before
 * they trust any of it (principle 2). Structural, so 317 passes the binding
 * itself.
 */
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

/** Whether `bits` are the area bits of `job`'s suite: each area it sent, once, in order. */
const answersJob = (job: CheckJob, bits: readonly HeldBackResult[]) => {
  const suite = job.heldBack;

  if (suite === undefined) {
    return bits.length === 0;
  }

  return (
    bits.length === suite.areas.length &&
    suite.areas.every((area, index) => {
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

/** A run whose area bits answer `job`, or `VerifierBlocked` with one log line naming nothing sealed. */
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
