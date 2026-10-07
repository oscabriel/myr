import { PolicyInput } from "@repo/protocol/domain/policy";
import { defaults, toPolicyInput } from "@repo/sdk";
import { Schema } from "effect";

/**
 * The policy a project with no config folder runs on (convex-merged design
 * §3, "no folder means defaults"): the sdk's own `defaults`, decoded, so the
 * default kinds and numbers have one home each. One `fix` kind whose asks a
 * vouched person claims, the run block found in the project's CI, and the
 * initializer deciding everything (spec D20); the rest is `PolicyInput`'s
 * own defaults: five decisions a day that wait 14 days, two proposals and
 * three claims per person, a claim warned after 2 hours and lapsed after 24,
 * a vouch for code in the config folder's `vouched.td`, `Assisted-by`
 * trailers, and a record that counts after 30 days for a year. It adds no
 * weakening markers: the gate scans its own defaults plus a project's.
 */
export const defaultPolicyInput: PolicyInput = Schema.decodeSync(PolicyInput)(
  toPolicyInput(defaults)
);
