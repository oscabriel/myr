import { PolicyInput } from "@repo/protocol/domain/policy";
import { defaults, toPolicyInput } from "@repo/sdk";
import { Schema } from "effect";

/** It adds no weakening markers: the gate scans its own defaults plus a project's. */
export const defaultPolicyInput: PolicyInput = Schema.decodeSync(PolicyInput)(
  toPolicyInput(defaults)
);
