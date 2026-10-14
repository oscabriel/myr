import type { Handle } from "@repo/protocol/ids";
import type { CapReached } from "@repo/protocol/refusal";
import { Context } from "effect";
import type { Effect } from "effect";

/** A post shares the proposal binding's window: both are words put to a project's maintainers. */
export type Limited = "claim" | "proposal" | "draft" | "post";

export class RateLimits extends Context.Service<
  RateLimits,
  {
    readonly check: (
      kind: Limited,
      handle: Handle
    ) => Effect.Effect<void, CapReached>;
  }
>()("platform/RateLimits") {}
