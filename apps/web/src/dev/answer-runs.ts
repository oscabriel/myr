/**
 * The inline runner, with a hold: a request the seed holds is never driven,
 * so the seed can judge a round the way the platform's landing guard would
 * (`apps/platform/src/workflows/answer/program.ts`), or leave one checking.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import type { CheckRunner } from "@repo/checks/check-runner";
import { AnswerRuns } from "@repo/project/answer-runs";
import { AnswerRunsInline } from "@repo/project/answer-runs/inline";
import type { Lander } from "@repo/project/lander";
import type { RequestId } from "@repo/protocol/ids";
import { Context, Effect, Layer, Ref } from "effect";

export class DevAnswerRuns extends Context.Service<
  DevAnswerRuns,
  { readonly hold: (requestId: RequestId) => Effect.Effect<void> }
>()("web/dev/DevAnswerRuns") {}

export const DevAnswerRunsLayer: Layer.Layer<
  AnswerRuns | DevAnswerRuns,
  never,
  CheckRunner | Lander | RepoHost
> = Layer.effectContext(
  Effect.gen(function* () {
    const inline = Context.get(
      yield* Layer.build(AnswerRunsInline),
      AnswerRuns
    );

    const held = yield* Ref.make<ReadonlySet<RequestId>>(new Set());

    return Context.make(
      AnswerRuns,
      AnswerRuns.of({
        start: (requestId, queue) =>
          Effect.flatMap(Ref.get(held), (ids) =>
            ids.has(requestId) ? Effect.void : inline.start(requestId, queue)
          ),
      })
    ).pipe(
      Context.add(DevAnswerRuns, {
        hold: (requestId) =>
          Ref.update(held, (ids) => new Set(ids).add(requestId)),
      })
    );
  })
);
