import { sameHandle } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { CapReached } from "@repo/protocol/refusal";
import { Effect, Layer, Ref } from "effect";

import { RateLimits } from "../rate-limits.ts";
import type { Limited } from "../rate-limits.ts";

export interface Limits {
  readonly claim: number;
  readonly draft: number;
  readonly post: number;
  readonly proposal: number;
}

// Mirrors each binding's `simple.limit` in wrangler.jsonc: a binding can't say its own limit.
export const WorkerCaps = {
  claim: 10,
  draft: 2,
  post: 5,
  proposal: 5,
} as const satisfies Limits;

const LIMIT_OF = {
  claim: "claims",
  draft: "drafts",
  post: "discussions",
  proposal: "proposals",
} as const satisfies Record<Limited, CapReached["limit"]>;

// A binding can't say when its window resets, so the whole 60 s period is the honest upper bound.
const WINDOW_SECONDS = 60;

const capped = (limits: Limits, kind: Limited) =>
  new CapReached({
    cap: limits[kind],
    limit: LIMIT_OF[kind],
    retryAfter: WINDOW_SECONDS,
  });

// A binding that fails is a defect: a call it could not count is not let through.
export const WorkerRateLimits = (bindings: {
  readonly claim: RateLimit;
  readonly draft: RateLimit;
  readonly proposal: RateLimit;
}): Layer.Layer<RateLimits> =>
  Layer.succeed(
    RateLimits,
    RateLimits.of({
      check: (kind, handle) =>
        Effect.tryPromise(() =>
          // A post is counted by the proposal binding, under its own cap.
          bindings[kind === "post" ? "proposal" : kind].limit({
            key: handle.toLowerCase(),
          })
        ).pipe(
          Effect.orDie,
          Effect.flatMap(({ success }) =>
            success ? Effect.void : Effect.fail(capped(WorkerCaps, kind))
          )
        ),
    })
  );

interface Spent {
  readonly handle: Handle;
  readonly kind: Limited;
}

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
