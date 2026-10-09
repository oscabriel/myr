/**
 * `DraftRuns` in process, for tests and the worlds that run without a
 * Workflow engine (the web's dev world, the platform's Node world): `start`
 * runs the round's program (`runDraft`) at once, to its settling, as
 * `@repo/project`'s `AnswerRunsInline` runs an answer's steps. Each step runs
 * once, its failures retried as its retries say, without waiting; nothing
 * is recorded, since nothing replays. A round already under way is not
 * started twice, and a run that dies is logged: the proposal stays
 * drafting, and its proposer may draft it again.
 *
 * The run reaches the project through `Projects`, which is built over the
 * project services that start runs: so the runs take their ports when a
 * round starts (`draftRunsInline`), and `withDraftRunsInline` ties the knot
 * for a `Projects` layer, handing its runs the `Projects` it builds.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { DraftRuns } from "@repo/project/draft-runs";
import type { DraftParams } from "@repo/project/draft-runs";
import { Projects } from "@repo/project/projects";
import { Context, Deferred, Effect, Layer, Ref } from "effect";

import type { Drafter } from "../drafter.ts";
import { runDraft } from "../run.ts";
import type { DraftSteps } from "../run.ts";

/** What a round runs on. */
export type InlinePorts = Projects | Drafter | RepoHost;

/** Steps run once each, in process: a failure retried as its retries say, at once. */
const inlineSteps: DraftSteps = {
  step: (_name, _schema, effect, retry) =>
    Effect.retry(effect, { times: retry?.limit ?? 0 }),
};

/** One round's key: its project, proposal and round. */
const keyOf = ({ project, proposal, round }: DraftParams) =>
  `${project}/${proposal}/${round}`;

/** `DraftRuns` that run each round in process, on the ports `portsOf` gives when it starts. */
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

/**
 * `projects` with in-process draft runs: every project service it builds
 * starts its rounds through `draftRunsInline`, which reaches the projects
 * through the `Projects` this layer builds.
 */
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
