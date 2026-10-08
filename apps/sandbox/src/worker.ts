/**
 * The sandbox Worker. Its default entrypoint is reached only through the
 * platform's `SANDBOX` service binding: each method takes a job's wire,
 * encoded, and returns the job's `Exit`, encoded as JSON, so both sides
 * decode with the schemas in `@repo/checks/check-runner/wire` and
 * `@repo/project/lander/wire`.
 */
import type { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
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
import { WorkerEntrypoint } from "cloudflare:workers";

import { runCheck } from "./checker.ts";
import { runBundleRules, runCompose, runLand, runMerge } from "./lander.ts";

export { Checker } from "./checker.ts";

export { Lander } from "./lander.ts";

// The Checker's container reaches out only through these, and its Durable
// Object finds them in `ctx.exports`, which holds a loopback for each export
// of this module alone (outbound.ts, env-gateway.ts).
export { CloneGateway, EgressGateway } from "./outbound.ts";

export { EnvGateway } from "./env-gateway.ts";

export default class Sandbox extends WorkerEntrypoint<Env> {
  check(wire: typeof CheckWire.Encoded): Promise<typeof CheckExit.Encoded> {
    return runCheck(this.env, wire);
  }

  merge(wire: typeof MergeWire.Encoded): Promise<typeof MergeExit.Encoded> {
    return runMerge(this.env, wire);
  }

  land(wire: typeof LandWire.Encoded): Promise<typeof LandExit.Encoded> {
    return runLand(this.env, wire);
  }

  compose(
    wire: typeof ComposeWire.Encoded
  ): Promise<typeof ComposeExit.Encoded> {
    return runCompose(this.env, wire);
  }

  bundleRules(
    wire: typeof BundleWire.Encoded
  ): Promise<typeof BundleExit.Encoded> {
    return runBundleRules(this.env, wire);
  }
}
