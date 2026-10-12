/**
 * `Projects` is built over the project services that start runs, so the runs
 * take their ports when a round starts, and `withDraftRunsInline` ties the
 * knot, handing its runs the `Projects` it builds.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { DraftRuns } from "@repo/project/draft-runs";
import type { DraftParams } from "@repo/project/draft-runs";
import { Projects } from "@repo/project/projects";
import { Context, Deferred, Effect, Layer, Ref } from "effect";

import type { Drafter } from "../drafter.ts";
import { runDraft } from "../run.ts";
import type { DraftSteps } from "../run.ts";

export type InlinePorts = Projects | Drafter | RepoHost;

const inlineSteps: DraftSteps = {
  step: (_name, _schema, effect, retry) =>
    Effect.retry(effect, { times: retry?.limit ?? 0 }),
};

const keyOf = ({ project, proposal, round }: DraftParams) =>
  `${project}/${proposal}/${round}`;

export const draftRunsInline = (
  portsOf: Effect.Effect<Context.Context<InlinePorts>>
): Layer.Layer<never> =>
  Layer.effect(
    DraftRuns,
    Effect.gen(function* () {
      const running = yield* Ref.make<ReadonlySet<string>>(new Set());

      const claimRun = (key: string) =>
        Ref.modify(running, (under) =>
          under.has(key) ? [false, under] : [true, new Set(under).add(key)]
        );

      const endRun = (key: string) =>
        Ref.update(running, (under) => {
          const rest = new Set(under);

          rest.delete(key);

          return rest;
        });

      return {
        start: (params) =>
          Effect.gen(function* () {
            const key = keyOf(params);

            if (!(yield* claimRun(key))) {
              return;
            }

            yield* runDraft(params, inlineSteps).pipe(
              Effect.provideContext(yield* portsOf),
              Effect.catchCause((cause) =>
                Effect.logWarning("a draft's run died", cause)
              ),
              Effect.ensuring(endRun(key))
            );
          }),
      };
    })
  );

export const withDraftRunsInline = <E, R>(
  projects: Layer.Layer<Projects, E, R>
): Layer.Layer<Projects, E, R | Drafter | RepoHost> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const ready = yield* Deferred.make<Context.Context<InlinePorts>>();

      const built = yield* Layer.build(
        projects.pipe(Layer.provide(draftRunsInline(Deferred.await(ready))))
      );

      const around = yield* Effect.context<Drafter | RepoHost>();

      yield* Deferred.succeed(ready, Context.merge(around, built));

      return Context.make(Projects, Context.get(built, Projects));
    })
  );
