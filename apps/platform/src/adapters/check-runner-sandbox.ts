/**
 * `CheckRunner` over the sandbox Worker (spec §4.3): each run goes to the
 * Checker through the `SANDBOX` service binding, with one read token on the
 * repo it clones from and nothing else. The Checker's container never sees
 * the token (W3 315); its outcome comes back as the port's own `CheckRun` or
 * `VerifierBlocked`.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import { CheckRunner } from "@repo/checks/check-runner";
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
          ).pipe(Effect.provideService(RepoHost, host)),
      });
    })
  );
