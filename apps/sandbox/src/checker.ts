// Each check job gets a Checker of its own (a unique id). A Checker named
// `snapshots:<project>` never starts a container: it only keeps that
// project's snapshot ids.
import { CheckAt } from "@repo/checks/check-runner";
import type { CheckRun } from "@repo/checks/check-runner";
import { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
import { keyOf } from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { DurableObject } from "cloudflare:workers";
import { Effect, Exit, Layer, Option, Redacted, Schema } from "effect";

import { SdkBox } from "./box/sdk.ts";
import { envPlanOf } from "./checker/env.ts";
import { WorkerCheckLogs } from "./checker/logs/worker.ts";
import { blocked, check } from "./checker/run.ts";
import { hasGateways, SdkChecker } from "./checker/sdk.ts";
import { answerJob } from "./job.ts";
import type { Job } from "./job.ts";
import { jobTelemetry } from "./telemetry.ts";

const DEFAULT_IMAGE = "checker:default";

const CHECK_IMAGE = "check";

/** oxlint's JS plugins reserve about 6 GiB of address space per thread; smaller sizes abort. */
export const checkInstance = "standard-3";

export const checkJob: Job<
  CheckWire,
  typeof CheckWire.Encoded,
  CheckRun,
  VerifierBlocked,
  typeof CheckExit.Encoded
> = {
  // A defect may quote a sealed file's path: its span keeps its name alone,
  // and the platform's report of it its name and frames.
  defects: "name",
  exit: CheckExit,
  ids: ({ job }) => ({
    project: job.project,
    sha: CheckAt.match(job.at, {
      Commit: ({ commit }): string => commit,
      Tree: ({ tree }): string => tree,
    }),
  }),
  name: "Checker.check",
  tokens: ({ clone }) => [clone.token],
  wire: CheckWire,
};

export class Checker extends DurableObject<Env> {
  check(wire: typeof CheckWire.Encoded): Promise<typeof CheckExit.Encoded> {
    return answerJob(checkJob, (job) => this.#checked(job))(wire);
  }

  snapshotOf(key: string): string | null {
    return this.ctx.storage.kv.get<string>(key) ?? null;
  }

  keepSnapshot(key: string, id: string): void {
    this.ctx.storage.kv.put(key, id);
  }

  forgetSnapshot(key: string): void {
    this.ctx.storage.kv.delete(key);
  }

  #checked(wire: CheckWire): Effect.Effect<CheckRun, VerifierBlocked> {
    const { container, exports } = this.ctx;

    if (container === undefined) {
      return blocked("the Checker has no container", { phase: "start" });
    }

    if (!hasGateways(exports)) {
      return blocked("worker.ts does not export the outbound gateways", {
        phase: "start",
      });
    }

    const image = container.images[CHECK_IMAGE];
    const wanted = wire.job.run.image ?? DEFAULT_IMAGE;

    if (image === undefined || wanted !== DEFAULT_IMAGE) {
      return blocked("no image for this run block", {
        image: wanted,
        phase: "start",
      });
    }

    const checkers: Checkers = this.env;

    const index = checkers.CHECKER.getByName(
      `snapshots:${keyOf(wire.job.project)}`
    );

    return check(wire).pipe(
      Effect.provide(
        Layer.mergeAll(
          SdkBox.layer(container, {
            enableInternet: false,
            image,
            instance: checkInstance,
          }),
          SdkChecker.layer(
            container,
            exports,
            {
              find: (key) => index.snapshotOf(key),
              forget: (key) => index.forgetSnapshot(key),
              keep: (key, id) => index.keepSnapshot(key, id),
            },
            {
              instance: checkInstance,
              // The hosts its env route may open, reserved ahead of the
              // catch-all intercept.
              proxied: Option.match(envPlanOf(wire.job).route, {
                onNone: () => [],
                onSome: ({ hosts }) => hosts,
              }),
            }
          ),
          WorkerCheckLogs.layer
        )
      )
    );
  }
}

/** Written out so the Checker reads plain RPC promises and a test needs no stub types. */
export interface Checkers {
  readonly CHECKER: {
    readonly newUniqueId: () => DurableObjectId;
    readonly get: (id: DurableObjectId) => {
      readonly check: (
        wire: typeof CheckWire.Encoded
      ) => Promise<typeof CheckExit.Encoded>;
    };
    readonly getByName: (name: string) => {
      readonly snapshotOf: (key: string) => Promise<string | null>;
      readonly keepSnapshot: (key: string, id: string) => Promise<void>;
      readonly forgetSnapshot: (key: string) => Promise<void>;
    };
  };
}

export const runCheck = (
  env: Checkers,
  wire: typeof CheckWire.Encoded
): Promise<typeof CheckExit.Encoded> =>
  Effect.runPromise(
    Effect.tryPromise(() =>
      env.CHECKER.get(env.CHECKER.newUniqueId()).check(wire)
    ).pipe(
      Effect.flatMap(Schema.decodeEffect(CheckExit)),
      Effect.tapError((failure) =>
        Effect.logError("the Checker could not be reached").pipe(
          Effect.annotateLogs({ reason: String(failure) })
        )
      ),
      Effect.orElseSucceed(() => Exit.fail(new VerifierBlocked({}))),
      Effect.flatMap(Schema.encodeEffect(CheckExit)),
      Effect.orDie,
      Effect.provide(jobTelemetry([Redacted.make(wire.clone.token)]))
    )
  );
