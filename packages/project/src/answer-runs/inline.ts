/**
 * `AnswerRuns` in process, for tests: `start` drives the answer's
 * steps (merge, checks, land) through the project's own answer queue until
 * the answer lands, is refused, or waits (on a person, the landing slot, or
 * a retry the project's alarm starts again). A run already under way for the
 * same request is not started twice.
 */
import type { CheckRunner } from "@repo/checks/check-runner";
import type { RequestId } from "@repo/protocol/ids";
import { Effect, Layer, Ref } from "effect";

import { AnswerRuns } from "../answer-runs.ts";
import type { Lander } from "../lander.ts";
import { drive } from "./steps.ts";

export const AnswerRunsInline: Layer.Layer<
  AnswerRuns,
  never,
  CheckRunner | Lander
> = Layer.effect(
  AnswerRuns,
  Effect.gen(function* () {
    const ports = yield* Effect.context<CheckRunner | Lander>();
    const running = yield* Ref.make<ReadonlySet<RequestId>>(new Set());

    const claimRun = (requestId: RequestId) =>
      Ref.modify(running, (under) =>
        under.has(requestId)
          ? [false, under]
          : [true, new Set(under).add(requestId)]
      );

    const endRun = (requestId: RequestId) =>
      Ref.update(running, (under) => {
        const rest = new Set(under);

        rest.delete(requestId);

        return rest;
      });

    return AnswerRuns.of({
      start: (requestId, queue) =>
        Effect.gen(function* () {
          if (!(yield* claimRun(requestId))) {
            return;
          }

          yield* drive(queue, requestId).pipe(
            Effect.provideContext(ports),
            Effect.ensuring(endRun(requestId))
          );
        }),
    });
  })
);
