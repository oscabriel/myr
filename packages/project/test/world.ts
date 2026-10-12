import { SqliteClient } from "@effect/sql-sqlite-node";
import { ForkInProgress, RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import type { CheckJob } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import type { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import type { Policy } from "@repo/protocol/domain/policy";
import type {
  CommitSha,
  LandedSha,
  LaneName,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import type { Scenario } from "@repo/testkit/scenarios";
import { Context, Effect, Layer, Option, Ref } from "effect";
import type { Array } from "effect";

import { AlarmsMemory } from "../src/alarms/memory.ts";
import { AnswerRunsInline } from "../src/answer-runs/inline.ts";
import { Lander } from "../src/lander.ts";
import { LanderIsogit } from "../src/lander/isogit.ts";
import type { ProjectStore } from "../src/project-store.ts";
import { ProjectStoreMemory } from "../src/project-store/memory.ts";
import { ProjectStoreSqlite } from "../src/project-store/sqlite.ts";
import { FinishersFromChecks } from "../src/project.ts";
import { Projection, ProjectionFailed } from "../src/projection.ts";
import { ProjectionMemory } from "../src/projection/memory.ts";

const mainRef = RefName.make("refs/heads/main");

export type StoreKind = "memory" | "sqlite";

export type WorldScenario = Pick<Scenario, "policy">;

export class CheckScript extends Context.Service<
  CheckScript,
  {
    readonly script: (
      at: CheckAt,
      lane: LaneName,
      results: readonly LaneOutcome[]
    ) => Effect.Effect<void>;
    readonly jobs: Effect.Effect<readonly CheckJob[]>;
  }
>()("test/CheckScript") {}

export class Evaluated extends Context.Service<
  Evaluated,
  { readonly shas: Effect.Effect<readonly LandedSha[]> }
>()("test/Evaluated") {}

export class Pusher extends Context.Service<
  Pusher,
  {
    readonly push: (
      repo: RepoName,
      parent: Option.Option<CommitSha>,
      files: Files,
      message?: string
    ) => Effect.Effect<CommitSha>;
  }
>()("test/Pusher") {}

const storeOf = (kind: StoreKind): Layer.Layer<ProjectStore> =>
  kind === "memory"
    ? ProjectStoreMemory
    : ProjectStoreSqlite.pipe(
        Layer.provide(
          SqliteClient.layer({ filename: ":memory:" }).pipe(Layer.orDie)
        )
      );

const rulesOf = (scenario: WorldScenario) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const finishers = yield* Finishers;
      const seen = yield* Ref.make<readonly LandedSha[]>([]);

      const evaluator = RulesEvaluator.of({
        call: () => Effect.succeed(false),
        evaluate: ({ at, facts, modules }) =>
          Effect.gen(function* () {
            yield* Ref.update(seen, (shas) => [...shas, at]);

            const { policy } = scenario;

            return {
              ...policy,
              asks: policy.asks.filter(({ file }) => file in modules.modules),
              at,
              judge: finishers.judgeClosure(policy.run, facts.ci),
            } satisfies Policy;
          }),
      });

      return Context.make(RulesEvaluator, evaluator).pipe(
        Context.add(Evaluated, { shas: Ref.get(seen) })
      );
    })
  );

const scriptOf = Layer.effectContext(
  Effect.gen(function* () {
    // The Checker reads its script when it runs, so the test may add to it later.
    const script = new Map<string, readonly LaneResult[]>();
    const jobs = yield* Ref.make<readonly CheckJob[]>([]);

    const memory = Context.get(
      yield* Layer.build(CheckRunnerMemory.layer(script)),
      CheckRunner
    );

    const runner = CheckRunner.of({
      run: (job) =>
        Ref.update(jobs, (given) => [...given, job]).pipe(
          Effect.andThen(memory.run(job))
        ),
    });

    return Context.make(CheckRunner, runner).pipe(
      Context.add(CheckScript, {
        jobs: Ref.get(jobs),
        script: (at, lane, results) =>
          Effect.sync(() => {
            script.set(
              scriptKey(at, lane),
              results.map((result) => ({
                command: `run ${lane}`,
                durationMs: 1,
                lane,
                result,
              }))
            );
          }),
      })
    );
  })
);

const pusher = Layer.effect(
  Pusher,
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const client = yield* gitClient(memoryFs());

    return Pusher.of({
      push: (repo, parent, files, message = "Work") =>
        Effect.gen(function* () {
          const sha = yield* client.commit(
            message,
            files,
            Option.toArray(parent)
          );

          yield* host
            .push(repo, client.source, [
              { from: parent, ref: mainRef, to: sha },
            ])
            .pipe(Effect.orDie);

          return sha;
        }),
    });
  })
);

export interface Faults {
  readonly failOnce?: boolean;
}

const hostOf = (base: Layer.Layer<RepoHost>) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        importFrom: (name, source) =>
          host.importFrom(name, {
            ...source,
            url: source.url.replace(/^https:\/\/example\.com\//u, "memory://"),
          }),
      });
    })
  ).pipe(Layer.provide(base));

const flakyHost = Layer.effect(
  RepoHost,
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const failed = yield* Ref.make(false);

    return RepoHost.of({
      ...host,
      fork: (base, name) =>
        Effect.flatMap(Ref.getAndSet(failed, true), (before) =>
          before
            ? host.fork(base, name)
            : Effect.fail(new ForkInProgress({ name }))
        ),
    });
  })
).pipe(Layer.provide(RepoHostMemory));

const flakyProjection = Layer.effectContext(
  Effect.gen(function* () {
    const kept = yield* Layer.build(ProjectionMemory);
    const projection = Context.get(kept, Projection);
    const failed = yield* Ref.make(false);

    return kept.pipe(
      Context.add(Projection, {
        apply: (rows) =>
          Effect.flatMap(Ref.getAndSet(failed, true), (before) =>
            before
              ? projection.apply(rows)
              : Effect.fail(
                  new ProjectionFailed({ reason: "the read model is down" })
                )
          ),
      })
    );
  })
);

const fixtures = (scenario: WorldScenario) =>
  Layer.mergeAll(scriptOf, rulesOf(scenario), pusher).pipe(
    Layer.provideMerge(FinishersFromChecks)
  );

export const worldOf = (
  scenario: WorldScenario,
  store: StoreKind,
  faults: Faults = {}
) =>
  Layer.mergeAll(
    AnswerRunsInline,
    AlarmsMemory,
    faults.failOnce === true ? flakyProjection : ProjectionMemory,
    storeOf(store)
  ).pipe(
    Layer.provideMerge(fixtures(scenario)),
    Layer.provideMerge(LanderIsogit),
    Layer.provideMerge(
      hostOf(faults.failOnce === true ? flakyHost : RepoHostMemory)
    )
  );

export const composedAt = (
  repo: RepoName,
  main: LandedSha,
  files: Array.NonEmptyReadonlyArray<{
    readonly content: string;
    readonly path: RepoPath;
  }>
) =>
  Effect.map(
    Lander.use((lander) => lander.compose({ files, main, repo })),
    ({ commit }) => CheckAt.cases.Commit.make({ commit })
  ).pipe(Effect.orDie);

export const mergedAt = (input: {
  readonly repo: RepoName;
  readonly main: LandedSha;
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly fork: RepoName;
}) =>
  Effect.map(
    Lander.use((lander) => lander.merge(input)),
    ({ tree }): CheckAt => CheckAt.cases.Tree.make({ tree })
  ).pipe(Effect.orDie);

export const cleanMergeAt = (input: {
  readonly repo: RepoName;
  readonly main: LandedSha;
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly fork: RepoName;
}) =>
  Effect.option(
    Effect.map(
      Lander.use((lander) => lander.merge(input)),
      ({ tree }): CheckAt => CheckAt.cases.Tree.make({ tree })
    )
  );
