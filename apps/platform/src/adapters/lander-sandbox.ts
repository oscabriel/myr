/**
 * `Lander` over the sandbox Worker (spec §4.3, D6): each job goes to the
 * trusted Lander container through the `SANDBOX` service binding, with the
 * fewest tokens it needs. Reads take read tokens: a merge on canonical and
 * the fork, a bundle on canonical. A write token on canonical goes only to
 * `land`, which moves `main` with a non-force compare-and-swap, and to
 * `compose`, which pushes its compose ref alone; never to a Checker, never
 * outside the platform's Workers (S1 change 2). The outcome comes back as
 * the port's own types or its refusals: `StaleBase`, `RepoBusy`,
 * `VerifierBlocked`.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import type { RepoName } from "@repo/artifacts/repo-host";
import { Lander, Rebuild } from "@repo/project/lander";
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
import { Effect, Layer } from "effect";

import type { SandboxBinding } from "./check-runner-sandbox.ts";
import { sandboxJob, withRemote } from "./sandbox-credentials.ts";
import type { RemoteNeed } from "./sandbox-credentials.ts";

const read = (repo: RepoName): RemoteNeed => ({ repo, scope: "read" });

const write = (repo: RepoName): RemoteNeed => ({ repo, scope: "write" });

/** One land, with every remote its wire carries. */
const landing = (sandbox: SandboxBinding, wire: typeof LandWire.Type) =>
  sandboxJob({
    exit: LandExit,
    job: wire,
    method: "land",
    remotes: wire.fork === undefined ? [wire.main] : [wire.main, wire.fork],
    send: (encoded) => sandbox.land(encoded),
    wire: LandWire,
  });

export const LanderSandbox = (
  sandbox: SandboxBinding
): Layer.Layer<Lander, never, RepoHost> =>
  Layer.effect(
    Lander,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return Lander.of({
        bundleRules: (job) =>
          withRemote("bundleRules", read(job.repo), (main) =>
            sandboxJob({
              exit: BundleExit,
              job: { job, main },
              method: "bundleRules",
              remotes: [main],
              send: (wire) => sandbox.bundleRules(wire),
              wire: BundleWire,
            })
          ).pipe(Effect.provideService(RepoHost, host)),
        compose: (job) =>
          withRemote("compose", write(job.repo), (main) =>
            sandboxJob({
              exit: ComposeExit,
              job: { job, main },
              method: "compose",
              remotes: [main],
              send: (wire) => sandbox.compose(wire),
              wire: ComposeWire,
            })
          ).pipe(Effect.provideService(RepoHost, host)),
        land: (job) =>
          withRemote("land", write(job.repo), (main) =>
            Rebuild.$match(job.rebuild, {
              Compose: () => landing(sandbox, { job, main }),
              Existing: () => landing(sandbox, { job, main }),
              // Only a merge reads the answer's commits, from its fork.
              Merge: ({ fork }) =>
                withRemote("land", read(fork), (forkRemote) =>
                  landing(sandbox, { fork: forkRemote, job, main })
                ),
            })
          ).pipe(Effect.provideService(RepoHost, host)),
        merge: (job) =>
          withRemote("merge", read(job.repo), (main) =>
            withRemote("merge", read(job.fork), (fork) =>
              sandboxJob({
                exit: MergeExit,
                job: { fork, job, main },
                method: "merge",
                remotes: [main, fork],
                send: (wire) => sandbox.merge(wire),
                wire: MergeWire,
              })
            )
          ).pipe(Effect.provideService(RepoHost, host)),
      });
    })
  );
