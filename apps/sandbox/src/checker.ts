/**
 * The Checker: one container per check job, holding no credential, where an
 * answer's lanes run (spec §4.3; OSR §5.3). Each job gets a Durable Object of
 * its own (a unique id), whose container is destroyed when the job ends; the
 * phases are `checker/run.ts`. The class name is frozen.
 *
 * One more Checker per project, named `snapshots:<project>`, never starts a
 * container: it keeps the ids of that project's setup snapshots, which every
 * check of the project shares.
 */
import type { CheckRun } from "@repo/checks/check-runner";
import { CheckExit } from "@repo/checks/check-runner/wire";
import type { CheckWire } from "@repo/checks/check-runner/wire";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { DurableObject } from "cloudflare:workers";
import { Effect, Exit, Layer, Schema } from "effect";

import { SdkBox } from "./box/sdk.ts";
import { CheckLogs } from "./checker/logs.ts";
import { blocked, check } from "./checker/run.ts";
import { hasGateways, SdkChecker } from "./checker/sdk.ts";
import { CheckerWire } from "./checker/wire.ts";
import { answerJob } from "./job.ts";

/** The run block's image a check runs in when it names none. */
const DEFAULT_IMAGE = "checker:default";

/** That image's name in `wrangler.jsonc`, built from `images/check.Dockerfile`. */
const CHECK_IMAGE = "check";

/** The Checker's Durable Object, which owns its container. */
export class Checker extends DurableObject<Env> {
  /** Runs one check job in this object's container, its outcome encoded. */
  check(wire: typeof CheckerWire.Encoded): Promise<typeof CheckExit.Encoded> {
    return answerJob(CheckerWire, CheckExit, (job) => this.#checked(job))(wire);
  }

  /** The snapshot id kept under `key`, on a project's snapshot index. */
  snapshotOf(key: string): string | null {
    return this.ctx.storage.kv.get<string>(key) ?? null;
  }

  keepSnapshot(key: string, id: string): void {
    this.ctx.storage.kv.put(key, id);
  }

  forgetSnapshot(key: string): void {
    this.ctx.storage.kv.delete(key);
  }

  #checked(wire: CheckerWire): Effect.Effect<CheckRun, VerifierBlocked> {
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
    const wanted = wire.job.run?.image ?? DEFAULT_IMAGE;

    if (image === undefined || wanted !== DEFAULT_IMAGE) {
      return blocked("no image for this run block", {
        image: wanted,
        phase: "start",
      });
    }

    const checkers: Checkers = this.env;
    const index = checkers.CHECKER.getByName(`snapshots:${wire.job.project}`);

    return check(wire).pipe(
      Effect.provide(
        Layer.mergeAll(
          SdkBox.layer(container, { enableInternet: false, image }),
          SdkChecker.layer(container, exports, {
            find: (key) => index.snapshotOf(key),
            forget: (key) => index.forgetSnapshot(key),
            keep: (key, id) => index.keepSnapshot(key, id),
          }),
          CheckLogs.logged
        )
      )
    );
  }
}

/**
 * What the Checker needs of the sandbox's env: a new Checker for each job,
 * and each project's snapshot index (a Checker that never starts a
 * container). `Env` has both; they are written out so the Checker reads them
 * as the plain promises Workers RPC returns, and a test stands Checkers in
 * without its stub types.
 */
export interface Checkers {
  readonly CHECKER: {
    readonly newUniqueId: () => DurableObjectId;
    readonly get: (id: DurableObjectId) => {
      readonly check: (
        wire: typeof CheckerWire.Encoded
      ) => Promise<typeof CheckExit.Encoded>;
    };
    readonly getByName: (name: string) => {
      readonly snapshotOf: (key: string) => Promise<string | null>;
      readonly keepSnapshot: (key: string, id: string) => Promise<void>;
      readonly forgetSnapshot: (key: string) => Promise<void>;
    };
  };
}

/**
 * One check job from the platform, run in a Checker of its own, its outcome
 * encoded. A Checker that cannot be reached at all is `VerifierBlocked`, as
 * the job would have been.
 */
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
      Effect.orDie
    )
  );
