/**
 * `RateLimits` adapters. `WorkerRateLimits` asks the Worker's rate-limit
 * bindings, one per kind, keyed by the caller's handle in lowercase (handles
 * compare without case). `MemoryRateLimits` counts in a `Ref` its layer
 * makes, for tests: a whole test is one window, so a count never resets.
 */
import { sameHandle } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { CapReached } from "@repo/protocol/refusal";
import { Effect, Layer, Ref } from "effect";

import { RateLimits } from "../rate-limits.ts";
import type { Limited } from "../rate-limits.ts";

/** How many of each kind one person may make. */
export interface Limits {
  readonly claim: number;
  readonly proposal: number;
}

/**
 * What `wrangler.jsonc` lets each binding admit per person, every 60 s, in
 * every stage: `CLAIM_LIMIT` and `PROPOSAL_LIMIT`'s `simple.limit`. A binding
 * can't say its own limit, so a refusal reads its cap here.
 */
export const WorkerCaps = { claim: 10, proposal: 5 } as const satisfies Limits;

/** A refusal for one more of `kind` than `limits` allow. */
const capped = (limits: Limits, kind: Limited) =>
  new CapReached({ cap: limits[kind] });

/**
 * The Worker's rate limits, one binding per kind. A binding that fails is a
 * defect: a call it could not count is not let through.
 */
export const WorkerRateLimits = (bindings: {
  readonly claim: RateLimit;
  readonly proposal: RateLimit;
}): Layer.Layer<RateLimits> =>
  Layer.succeed(
    RateLimits,
    RateLimits.of({
      check: (kind, handle) =>
        Effect.tryPromise(() =>
          bindings[kind].limit({ key: handle.toLowerCase() })
        ).pipe(
          Effect.orDie,
          Effect.flatMap(({ success }) =>
            success ? Effect.void : Effect.fail(capped(WorkerCaps, kind))
          )
        ),
    })
  );

/** One spend: of which kind, by whom. */
interface Spent {
  readonly handle: Handle;
  readonly kind: Limited;
}

/** `limits` of each kind per person, counted in memory. */
export const MemoryRateLimits = (limits: Limits): Layer.Layer<RateLimits> =>
  Layer.effect(
    RateLimits,
    Effect.gen(function* () {
      const spent = yield* Ref.make<readonly Spent[]>([]);

      return RateLimits.of({
        check: (kind, handle) =>
          Effect.flatMap(
            Ref.modify(spent, (all) => {
              const count = all.filter(
                (each) => each.kind === kind && sameHandle(each.handle, handle)
              ).length;

              return [count < limits[kind], [...all, { handle, kind }]];
            }),
            (allowed) =>
              allowed ? Effect.void : Effect.fail(capped(limits, kind))
          ),
      });
    })
  );
