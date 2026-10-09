/**
 * The `RateLimits` port: how often one person may claim and propose across
 * the platform, whatever project they call. It sits
 * in front of the projects' own caps: a call past it reaches no project.
 * A flag on an ask is a proposal, so it spends the proposal limit.
 *
 * Adapters: `WorkerRateLimits` over the Worker's rate-limit bindings, and
 * `MemoryRateLimits` for tests (both in `adapters/rate-limits.ts`).
 */
import type { Handle } from "@repo/protocol/ids";
import type { CapReached } from "@repo/protocol/refusal";
import { Context } from "effect";
import type { Effect } from "effect";

/** What a rate limit counts: claims, proposals (flags among them), or drafts. */
export type Limited = "claim" | "proposal" | "draft";

export class RateLimits extends Context.Service<
  RateLimits,
  {
    /** Spends one of `handle`'s `kind`; past the limit, `CapReached`. */
    readonly check: (
      kind: Limited,
      handle: Handle
    ) => Effect.Effect<void, CapReached>;
  }
>()("platform/RateLimits") {}
