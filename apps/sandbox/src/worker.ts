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

// `ctx.exports` holds a loopback only for the main module's exports.
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
