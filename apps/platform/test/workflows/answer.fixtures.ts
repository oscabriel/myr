/**
 * One project with one answer admitted and waiting for its Answer Workflow,
 * over in-process adapters: `RepoHostMemory`, W2's isomorphic-git `Lander`
 * over it (recorded, and able to answer `RepoBusy`), a `CheckRunner`
 * scripted per (tree or commit, lane), a `RulesEvaluator` that returns the
 * scenario's policy, `ProjectsMemory`, `EvidenceStoreMemory`, and an
 * `AnswerRuns` that only records which runs the project started: the test
 * runs the Workflow's program itself.
 *
 * The Lander is the isomorphic-git one, not the scripted `/memory` one,
 * because the project reads real commits on the way to an admitted answer
 * (the ask's files composed onto main, the answer's diff for the gate), and
 * a re-merge after main moved must produce a real tree.
 */
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CheckAt, CheckRunner, shaOf } from "@repo/checks/check-runner";
import type { CheckJob, LaneEvidence } from "@repo/checks/check-runner";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRuns } from "@repo/project/answer-runs";
import type { AnswerReport } from "@repo/project/answer-runs";
import { Lander } from "@repo/project/lander";
import type { MergeJob } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { LanderJob } from "@repo/project/lander/memory";
import type { LandingCommand } from "@repo/project/landing";
import { FinishersFromChecks } from "@repo/project/project";
import type { ProjectApi } from "@repo/project/project";
import { ProjectionMemory } from "@repo/project/projection/memory";
import { Projects } from "@repo/project/projects";
import { ProjectsMemory } from "@repo/project/projects/memory";
import type { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  LandedSha,
  LaneName,
  RepoName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { RepoBusy, VerifierBlocked } from "@repo/protocol/refusal";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { advanceTo } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Context, Effect, Layer, Option, Ref, Schema } from "effect";

import { StepRunner } from "../../src/workflows/step.ts";
import type { StepRetry } from "../../src/workflows/step.ts";

const mainRef = RefName.make("refs/heads/main");

const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

/**
 * The scenario's policy, with a `unit` lane beside its cheap `lint` and
 * `types` lanes: the checks stage runs the ask's own check and `unit`.
 */
export const policy: Policy = Schema.decodeSync(Policy)({
  ...Schema.encodeSync(Policy)(scenario.policy),
  run: {
    checks: {
      lint: "bun run lint",
      types: "bun run typecheck",
      unit: "bun run test",
    },
    test: "bun test {path}",
  },
});

export const { project } = scenario;

export const repo = RepoName.make(project);

export const alice = Person.make({ handle: scenario.initializer });

export const bob = Person.make({
  handle: scenario.people.get("bob") ?? scenario.initializer,
});

export const parseIso = AskId.make("parse-iso");

export const bobFork = RepoName.make(`${project}--${parseIso}--${bob.handle}`);

const ask: Ask = Option.getOrThrow(
  Array.findFirst(policy.asks, ({ id }) => id === parseIso)
);

/** The lane the ask's own check reports as. */
export const askLane = LaneName.make("redThenGreen");

/** Where the ask's check lives: red on main, green once answered. */
export const checkPath = CheckSpec.guards.RedThenGreen(ask.check)
  ? ask.check.path
  : RepoPath.make("packages/parser/test/parse-iso.test.ts");

/** The file the answer changes. */
export const parsePath = RepoPath.make("packages/parser/src/parse.ts");

/** A file the answer leaves alone. */
export const lexPath = RepoPath.make("packages/lexer/src/lex.ts");

/** The project as alice first pushes it. */
const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  [lexPath, "export const lex = (s) => s.split(' ');\n"],
  [parsePath, "export const parse = (s) => ({});\n"],
];

/** The ask's own files: its file in the config folder, and its check. */
const askFiles = Array.make(
  { content: `export default "${parseIso}";\n`, path: ask.file },
  {
    content: [
      `import { expect, it } from "vitest";`,
      `import { parse } from "../src/parse.ts";`,
      ``,
      `it("${parseIso}", () => {`,
      `  expect(parse("2026-10-07")).toStrictEqual({ year: 2026 });`,
      `});`,
      ``,
    ].join("\n"),
    path: checkPath,
  }
);

/** Main once the ask opened: alice's files and the ask's. */
export const openedFiles: Files = [
  ...start,
  ...askFiles.map(({ content, path }) => [path, content] as const),
];

/** `files` with `path` holding `content`, added or replaced. */
export const changed = (files: Files, path: string, content: string): Files => [
  ...files.filter(([each]) => each !== path),
  [path, content],
];

/** Bob's answer: main once the ask opened, with `parse` fixed. */
export const fixed = changed(
  openedFiles,
  parsePath,
  "export const parse = (s) => ({ year: 2026 });\n"
);

// ------------------------------------------------------------------ checker

/** One scripted run of a lane: how it ends, and its failure's signature. */
export interface ScriptedRun {
  readonly result: LaneOutcome;
  /** What the failing test said, as `checks.classify` writes a signature. */
  readonly signature?: string;
}

/** The scripted Checker's script, and every job it was given. */
export class Checker extends Context.Service<
  Checker,
  {
    readonly script: (
      at: CheckAt,
      lane: LaneName,
      runs: readonly ScriptedRun[]
    ) => Effect.Effect<void>;
    readonly jobs: Effect.Effect<readonly CheckJob[]>;
  }
>()("test/Checker") {}

/** Where a lane's script lives: `<tree or commit sha>:<lane>`. */
const keyOf = (at: CheckAt, lane: LaneName) => `${shaOf(at)}:${lane}`;

/**
 * `CheckRunner` scripted per (tree or commit, lane), as `CheckRunnerMemory`
 * is, with each failure's signature too: each key serves its runs in order,
 * then the last again. A job with a lane nobody scripted is
 * `VerifierBlocked`, as a Checker that cannot run is.
 */
const checker = Layer.effectContext(
  Effect.gen(function* () {
    const scripts = yield* Ref.make<
      ReadonlyMap<string, readonly ScriptedRun[]>
    >(new Map());

    const served = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
    const jobs = yield* Ref.make<readonly CheckJob[]>([]);

    const next = (
      key: string,
      runs: Array.NonEmptyReadonlyArray<ScriptedRun>
    ) =>
      Ref.modify(served, (counts) => {
        const count = counts.get(key) ?? 0;

        return [
          runs[Math.min(count, runs.length - 1)] ?? runs[0],
          new Map(counts).set(key, count + 1),
        ] as const;
      });

    const run = (job: CheckJob) =>
      Effect.gen(function* () {
        yield* Ref.update(jobs, (given) => [...given, job]);

        const known = yield* Ref.get(scripts);

        const scripted = yield* Effect.forEach(job.lanes, (lane) =>
          Option.match(
            Option.filter(
              Option.fromUndefinedOr(known.get(keyOf(job.at, lane.lane))),
              Array.isReadonlyArrayNonEmpty
            ),
            {
              onNone: () => Effect.fail(new VerifierBlocked({})),
              onSome: (runs) => Effect.succeed({ lane, runs }),
            }
          )
        );

        const ran = yield* Effect.forEach(scripted, ({ lane, runs }) =>
          Effect.map(next(keyOf(job.at, lane.lane), runs), (one) => ({
            lane,
            one,
          }))
        );

        const lanes = ran.map(({ lane, one }): LaneResult => ({
          command: lane.command,
          durationMs: 1,
          lane: lane.lane,
          result: one.result,
        }));

        const evidence = ran.flatMap(({ lane, one }): LaneEvidence[] => {
          if (one.result === "passed") {
            return [];
          }

          return one.signature === undefined
            ? [{ lane: lane.lane }]
            : [{ lane: lane.lane, signature: one.signature }];
        });

        return { durationMs: lanes.length, evidence, heldBack: [], lanes };
      });

    return Context.make(CheckRunner, { run }).pipe(
      Context.add(Checker, {
        jobs: Ref.get(jobs),
        script: (at, lane, runs) =>
          Ref.update(scripts, (known) =>
            new Map(known).set(keyOf(at, lane), runs)
          ),
      })
    );
  })
);

// ------------------------------------------------------------------- lander

/** What the Lander was asked, and a way to make its next lands busy. */
export class LanderCalls extends Context.Service<
  LanderCalls,
  {
    /** Every job the project and the program gave the Lander, in order. */
    readonly jobs: Effect.Effect<readonly LanderJob[]>;
    /** The next `count` lands find the repo busy, and push nothing. */
    readonly busyFor: (count: number) => Effect.Effect<void>;
    /** The merge a test scripts the checks for, unrecorded. */
    readonly preview: (job: MergeJob) => Effect.Effect<CheckAt>;
  }
>()("test/LanderCalls") {}

/** The isomorphic-git Lander, recorded, whose lands a test can make busy. */
const lander = Layer.effectContext(
  Effect.gen(function* () {
    const inner = yield* Lander;
    const jobs = yield* Ref.make<readonly LanderJob[]>([]);
    const busy = yield* Ref.make(0);
    const keep = (job: LanderJob) => Ref.update(jobs, (all) => [...all, job]);

    const land: Lander["Service"]["land"] = (job) =>
      Effect.gen(function* () {
        yield* keep(LanderJob.Land({ job }));

        const left = yield* Ref.getAndUpdate(busy, (n) => Math.max(n - 1, 0));

        return left > 0 ? yield* new RepoBusy({}) : yield* inner.land(job);
      });

    return Context.make(Lander, {
      bundleRules: (job) =>
        Effect.andThen(
          keep(LanderJob.BundleRules({ job })),
          inner.bundleRules(job)
        ),
      compose: (job) =>
        Effect.andThen(keep(LanderJob.Compose({ job })), inner.compose(job)),
      land,
      merge: (job) =>
        Effect.andThen(keep(LanderJob.Merge({ job })), inner.merge(job)),
    }).pipe(
      Context.add(LanderCalls, {
        busyFor: (count) => Ref.set(busy, count),
        jobs: Ref.get(jobs),
        preview: (job) =>
          Effect.map(inner.merge(job), ({ tree }) =>
            CheckAt.cases.Tree.make({ tree })
          ).pipe(Effect.orDie),
      })
    );
  })
).pipe(Layer.provide(LanderIsogit));

// ------------------------------------------------------------- the project

/**
 * A `RulesEvaluator` that evaluates nothing: at any commit it returns
 * `given`, holding the asks whose files the commit's config folder has, and
 * the judge closure `checks` derives.
 */
const rulesOf = (given: Policy) =>
  Layer.effect(
    RulesEvaluator,
    Effect.gen(function* () {
      const finishers = yield* Finishers;

      return RulesEvaluator.of({
        call: () => Effect.succeed(false),
        evaluate: ({ at, facts, modules }) =>
          Effect.succeed({
            ...given,
            asks: given.asks.filter(({ file }) => file in modules.modules),
            at,
            judge: finishers.judgeClosure(given.run, facts.ci),
          } satisfies Policy),
      });
    })
  ).pipe(Layer.provide(FinishersFromChecks));

/** Which answer runs the project started: the program runs them in the test. */
export class Started extends Context.Service<
  Started,
  { readonly ids: Effect.Effect<readonly RequestId[]> }
>()("test/Started") {}

const started = Layer.effectContext(
  Effect.map(Ref.make<readonly RequestId[]>([]), (ids) =>
    Context.make(AnswerRuns, {
      start: (requestId) => Ref.update(ids, (all) => [...all, requestId]),
    }).pipe(Context.add(Started, { ids: Ref.get(ids) }))
  )
);

/** One `advanceAnswer` call the project took, as the program made it. */
export interface Advance {
  readonly command: LandingCommand;
  readonly report: AnswerReport | undefined;
}

/** Every `advanceAnswer` call made through `Projects`, in order. */
export class DoCalls extends Context.Service<
  DoCalls,
  { readonly advances: Effect.Effect<readonly Advance[]> }
>()("test/DoCalls") {}

/** `ProjectsMemory`, with every `advanceAnswer` through it recorded. */
const projects = Layer.effectContext(
  Effect.gen(function* () {
    const inner = yield* Projects;
    const advances = yield* Ref.make<readonly Advance[]>([]);

    const recorded = (api: ProjectApi): ProjectApi => ({
      ...api,
      advanceAnswer: (requestId, command, report) =>
        Effect.andThen(
          Ref.update(advances, (all) => [...all, { command, report }]),
          api.advanceAnswer(requestId, command, report)
        ),
    });

    return Context.make(Projects, {
      create: (name) => Effect.map(inner.create(name), recorded),
      get: (name) => Effect.map(inner.get(name), recorded),
    }).pipe(Context.add(DoCalls, { advances: Ref.get(advances) }));
  })
).pipe(Layer.provide(ProjectsMemory));

/** Commits made the way git would make them, pushed to a repo's `main`. */
export class Pusher extends Context.Service<
  Pusher,
  {
    readonly push: (
      repo: RepoName,
      parent: Option.Option<CommitSha>,
      files: Files
    ) => Effect.Effect<CommitSha>;
  }
>()("test/Pusher") {}

const pusher = Layer.effect(
  Pusher,
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const client = yield* gitClient(memoryFs());

    return Pusher.of({
      push: (to, parent, files) =>
        Effect.gen(function* () {
          const sha = yield* client.commit(
            "Work",
            files,
            Option.toArray(parent)
          );

          yield* host
            .push(to, client.source, [{ from: parent, ref: mainRef, to: sha }])
            .pipe(Effect.orDie);

          return sha;
        }),
    });
  })
);

/**
 * Every port the program runs on, and what the test reads back, with the
 * project's rules evaluating to `given`; fresh per build.
 */
export const worldWith = (given: Policy) =>
  Layer.mergeAll(projects, pusher).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        started,
        AlarmsMemory,
        ProjectionMemory,
        rulesOf(given),
        checker,
        EvidenceStoreMemory
      )
    ),
    Layer.provideMerge(lander),
    Layer.provideMerge(RepoHostMemory)
  );

/** The world over the scenario's policy. */
export const world = worldWith(policy);

/** The scenario's policy, with answers to a `fix` ask landing only once a decider finishes them. */
export const finishRequired: Policy = {
  ...policy,
  kinds: policy.kinds.map((kind) =>
    kind.name === "fix" ? { ...kind, finish: "required" } : kind
  ),
};

/** Where canonical `main` stands now. */
export const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

/** Every lane but the ask's, scripted the same on `at`. */
export const scriptProjectLanes = (at: CheckAt, run: ScriptedRun) =>
  Checker.use((script) =>
    Effect.forEach(
      Object.keys(policy.run.checks),
      (lane) => script.script(at, LaneName.make(lane), [run]),
      { discard: true }
    )
  );

/** One answer admitted: its project, its request, where it was made and checked. */
export interface Admitted {
  readonly api: ProjectApi;
  readonly requestId: RequestId;
  /** The main the answer was made on: the ask's opening landing. */
  readonly opened: LandedSha;
  readonly head: CommitSha;
  /** The tree the answer merges onto `opened` as. */
  readonly merged: CheckAt;
}

/**
 * The project made, its ask opened red first, bob's claim, his push of
 * `files` to his fork and his answer admitted: its run started, and no step
 * of it run yet. The checks on the merged tree are left to the test.
 */
export const admitted = (files: Files = fixed) =>
  Effect.gen(function* () {
    yield* advanceTo("2026-10-07T12:00:00Z");

    const api = yield* Projects.use((each) => each.create(project)).pipe(
      Effect.orDie
    );

    yield* api.initProject(alice, {}).pipe(Effect.orDie);

    const first = yield* Pusher.use((each) =>
      each.push(repo, Option.none(), start)
    );

    yield* api.recordFirstPush(alice, first).pipe(Effect.orDie);

    const composed = yield* Lander.use((each) =>
      each.compose({ files: askFiles, main: LandedSha.make(first), repo })
    ).pipe(Effect.orDie);

    yield* Checker.use((script) =>
      script.script(
        CheckAt.cases.Commit.make({ commit: composed.commit }),
        askLane,
        [{ result: "failed", signature: `${parseIso}: red` }]
      )
    );

    const open = yield* api
      .openAsk(alice, { ask: parseIso, files: askFiles })
      .pipe(Effect.orDie);

    yield* api.claim(bob, parseIso).pipe(Effect.orDie);

    const head = yield* Pusher.use((each) =>
      each.push(bobFork, Option.some(open.landed), files)
    );

    const merged = yield* LanderCalls.use((calls) =>
      calls.preview({
        base: open.landed,
        fork: bobFork,
        head,
        main: open.landed,
        repo,
      })
    );

    const receipt = yield* api
      .submitAnswer(bob, {
        ask: parseIso,
        base: open.landed,
        head,
        requestId: RequestId.make(`push-${head}`),
      })
      .pipe(Effect.orDie);

    return {
      api,
      head,
      merged,
      opened: open.landed,
      requestId: receipt.requestId,
    } satisfies Admitted;
  });

/** Main moved by a push the platform did not make: `files` on top of `from`. */
export const mainMoved = (from: LandedSha, files: Files) =>
  Effect.map(
    Pusher.use((each) => each.push(repo, Option.some(from), files)),
    (sha) => LandedSha.make(sha)
  );

/** The verdict the project keeps on bob's answer. */
export const verdictOf = (api: ProjectApi) =>
  Effect.map(api.verdict(bob, { ask: parseIso }), ({ verdict }) =>
    Option.fromUndefinedOr(verdict)
  ).pipe(Effect.orDie);

// -------------------------------------------------------------------- steps

/** Every step the program asked for, by name, in order, and each one's retries. */
export class StepLog extends Context.Service<
  StepLog,
  {
    readonly names: Effect.Effect<readonly string[]>;
    readonly retries: Effect.Effect<ReadonlyMap<string, StepRetry>>;
  }
>()("test/StepLog") {}

/**
 * `inner`'s steps, each name the program asks for recorded, replays
 * included. With `twice`, a step that runs runs its effect twice and keeps
 * the second value, as an engine does when it retries a step whose first
 * run took effect before its record was written.
 */
export const logged = (
  inner: Layer.Layer<StepRunner>,
  options: { readonly twice?: boolean } = {}
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const runner = yield* StepRunner;
      const names = yield* Ref.make<readonly string[]>([]);

      const retries = yield* Ref.make<ReadonlyMap<string, StepRetry>>(
        new Map()
      );

      return Context.make(StepRunner, {
        step: (name, schema, effect, retry) =>
          Effect.gen(function* () {
            yield* Ref.update(names, (all) => [...all, name]);

            if (retry !== undefined) {
              yield* Ref.update(retries, (all) =>
                new Map(all).set(name, retry)
              );
            }

            return yield* runner.step(
              name,
              schema,
              options.twice === true ? Effect.andThen(effect, effect) : effect,
              retry
            );
          }),
      }).pipe(
        Context.add(StepLog, {
          names: Ref.get(names),
          retries: Ref.get(retries),
        })
      );
    })
  ).pipe(Layer.provide(inner));
