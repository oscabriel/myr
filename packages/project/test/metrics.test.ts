import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { CheckAt } from "@repo/checks/check-runner";
import type { CheckRunner } from "@repo/checks/check-runner";
import { CheckSpec } from "@repo/protocol/domain/check";
import {
  AskId,
  LandedSha,
  LaneName,
  ProjectName,
  ProposalId,
  RepoName,
  RepoPath,
  keyOf,
  RequestId,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { NotRedFirst } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import {
  Array,
  Context,
  Effect,
  Fiber,
  Latch,
  Layer,
  Option,
  Ref,
} from "effect";

import { AnswerRuns } from "../src/answer-runs.ts";
import type { AnswerQueue } from "../src/answer-runs.ts";
import { drive, isStep, nextSteps, runStep } from "../src/answer-runs/steps.ts";
import { DraftResult } from "../src/draft-runs.ts";
import type { Lander } from "../src/lander.ts";
import { LandingCommand, LandingState } from "../src/landing.ts";
import { MetricPoint, Metrics } from "../src/metrics.ts";
import { dataPointOf, MetricsBinding } from "../src/metrics/binding.ts";
import type { DataPoint } from "../src/metrics/binding.ts";
import { MetricsMemory, MetricsWritten } from "../src/metrics/memory.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { Projection } from "../src/projection.ts";
import { ProjectionMemory } from "../src/projection/memory.ts";
import { CheckScript, composedAt, mergedAt, Pusher, worldOf } from "./world.ts";

const datekit = ProjectName.make("alice/datekit");

const written = (points: readonly MetricPoint[]) =>
  Effect.gen(function* () {
    const rows: DataPoint[] = [];

    yield* Metrics.use((metrics) => metrics.write(points)).pipe(
      Effect.provide(
        MetricsBinding({
          writeDataPoint: (row) => {
            rows.push(row);
          },
        })
      )
    );

    return rows;
  });

describe("the Analytics Engine adapter", () => {
  it.effect(
    "writes each point as one row: the project its index, its names its blobs, its numbers its doubles",
    () =>
      Effect.gen(function* () {
        const rows = yield* written([
          MetricPoint.cases.Landed.make({ project: datekit }),
          MetricPoint.cases.Refused.make({
            project: datekit,
            stage: "shape",
            tag: "OutOfScope",
          }),
          MetricPoint.cases.Refused.make({
            area: "parser",
            project: datekit,
            stage: "heldBack",
            tag: "HeldBackFailed",
          }),
          MetricPoint.cases.LaneRan.make({
            durationMs: 4200,
            lane: LaneName.make("lint"),
            project: datekit,
            result: "failed",
          }),
          MetricPoint.cases.ChecksWaited.make({
            project: datekit,
            waitedMs: 120_000,
          }),
          MetricPoint.cases.Drafted.make({
            attempts: 2,
            latencyMs: 95_000,
            project: datekit,
            ready: true,
          }),
        ]);

        expect(rows).toStrictEqual([
          { blobs: ["Landed"], doubles: [1], indexes: ["alice/datekit"] },
          {
            blobs: ["Refused", "OutOfScope", "shape", ""],
            doubles: [1],
            indexes: ["alice/datekit"],
          },
          {
            blobs: ["Refused", "HeldBackFailed", "heldBack", "parser"],
            doubles: [1],
            indexes: ["alice/datekit"],
          },
          {
            blobs: ["LaneRan", "lint", "failed"],
            doubles: [4200],
            indexes: ["alice/datekit"],
          },
          {
            blobs: ["ChecksWaited"],
            doubles: [120_000],
            indexes: ["alice/datekit"],
          },
          {
            blobs: ["Drafted", "ready"],
            doubles: [95_000, 2],
            indexes: ["alice/datekit"],
          },
        ]);
      })
  );

  it("cuts a project's name to the 96 bytes an index holds", () => {
    const long = ProjectName.make(`alice/${"a".repeat(120)}`);

    expect(
      dataPointOf(MetricPoint.cases.Landed.make({ project: long })).indexes
    ).toStrictEqual([long.slice(0, 96)]);
  });

  it.effect(
    "drops a point the dataset refuses, and writes the rest, failing nothing",
    () =>
      Effect.gen(function* () {
        const rows: DataPoint[] = [];

        const refusing = MetricsBinding({
          writeDataPoint: (row) => {
            if (row.blobs[0] === "Refused") {
              throw new Error("a blob over the limit");
            }

            rows.push(row);
          },
        });

        yield* Metrics.use((metrics) =>
          metrics.write([
            MetricPoint.cases.Refused.make({
              project: datekit,
              stage: "parse",
              tag: "NotClaimed",
            }),
            MetricPoint.cases.Landed.make({ project: datekit }),
          ])
        ).pipe(Effect.provide(refusing));

        expect(rows).toStrictEqual([
          { blobs: ["Landed"], doubles: [1], indexes: ["alice/datekit"] },
        ]);
      })
  );
});

describe("the memory adapter", () => {
  it.effect("keeps every point written, in the order it was written", () =>
    Effect.gen(function* () {
      const landed = MetricPoint.cases.Landed.make({ project: datekit });

      const waited = MetricPoint.cases.ChecksWaited.make({
        project: datekit,
        waitedMs: 5,
      });

      yield* Metrics.use((metrics) => metrics.write([landed]));
      yield* Metrics.use((metrics) => metrics.write([waited, landed]));

      expect(yield* MetricsWritten.use(({ points }) => points)).toStrictEqual([
        landed,
        waited,
        landed,
      ]);
    }).pipe(Effect.provide(MetricsMemory))
  );
});

const people = ["bob", "dave"];

const scenario = aProject({ people }).pipe(
  withVouches(people),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "format-date", territory: "packages/format" })
);

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const mainRef = RefName.make("refs/heads/main");

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

const alice = person("alice");

const bob = person("bob");

const dave = person("dave");

const forkOf = (ask: string, who: Person) =>
  RepoName.make(`${keyOf(project)}--${ask}--${who.handle}`);

const redThenGreen = LaneName.make("redThenGreen");

const lint = LaneName.make("lint");

const types = LaneName.make("types");

const lanes = [redThenGreen, lint, types];

const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  [
    "packages/format/src/format.ts",
    "export const format = (d) => String(d);\n",
  ],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

const askOf = (id: string) =>
  Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, (ask) => ask.id === id)
  );

const askFiles = (id: string) => {
  const { check, file, territory } = askOf(id);
  const subject = territory.module;

  return Array.make(
    { content: `export default "${id}";\n`, path: file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { ${subject} } from "../src/${subject}.ts";`,
        ``,
        `it("${id}", () => {`,
        `  expect(${subject}("2026-10-07")).toStrictEqual({ year: 2026 });`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(check)
        ? check.path
        : RepoPath.make(`test/${id}.test.ts`),
    }
  );
};

const withAskFiles = (files: Files, ...ids: readonly string[]): Files => [
  ...files,
  ...ids.flatMap((id) =>
    askFiles(id).map(({ content, path }) => [path, content] as const)
  ),
];

const changed = (files: Files, path: string, content: string): Files => [
  ...files.filter(([each]) => each !== path),
  [path, content],
];

const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

const script = (
  on: CheckAt,
  results: Readonly<Record<string, "passed" | "failed">>
) =>
  CheckScript.use((checker) =>
    Effect.forEach(
      lanes,
      (lane) => checker.script(on, lane, [results[lane] ?? "passed"]),
      { discard: true }
    )
  );

const openRed = (api: ProjectApi, id: string) =>
  Effect.gen(function* () {
    const files = askFiles(id);
    const composed = yield* composedAt(repo, yield* mainTip, files);

    yield* CheckScript.use((checker) =>
      checker.script(composed, redThenGreen, ["failed", "failed"])
    );

    return yield* api.openAsk(alice, { ask: AskId.make(id), files });
  });

class HeldRuns extends Context.Service<
  HeldRuns,
  {
    /** Runs every answer started so far, as a Workflow would once it is scheduled. */
    readonly drive: Effect.Effect<void, never, CheckRunner | Lander | RepoHost>;
  }
>()("test/HeldRuns") {}

type Driver = (
  queue: AnswerQueue,
  requestId: RequestId
) => Effect.Effect<void, never, CheckRunner | Lander | RepoHost>;

/** Each step run once and its report sent twice, as a Workflow step retried after its call landed would. */
const heardTwice: Driver = (queue, requestId) =>
  Effect.gen(function* () {
    const run = yield* queue.answer(requestId);

    const effect = Option.flatMap(run, (found) =>
      Array.findFirst(nextSteps(found), isStep)
    );

    if (Option.isNone(run) || Option.isNone(effect)) {
      return;
    }

    const step = yield* runStep(run.value, effect.value, queue.landings);

    if (Option.isNone(step)) {
      return;
    }

    const { command, report } = step.value;

    yield* queue.advanceAnswer(requestId, command, report);
    yield* queue.advanceAnswer(requestId, command, report);
    yield* heardTwice(queue, requestId);
  });

/** Answer runs that start only when the test drives them, so time passes between an answer's queueing and its checks. */
const heldRuns = (driver: Driver) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const held = yield* Ref.make<ReadonlyMap<RequestId, AnswerQueue>>(
        new Map()
      );

      return Context.make(
        AnswerRuns,
        AnswerRuns.of({
          start: (requestId, queue) =>
            Ref.update(held, (all) => new Map(all).set(requestId, queue)),
        })
      ).pipe(
        Context.add(HeldRuns, {
          drive: Effect.flatMap(Ref.getAndSet(held, new Map()), (all) =>
            Effect.forEach(
              all,
              ([requestId, queue]) => driver(queue, requestId),
              {
                discard: true,
              }
            )
          ),
        })
      );
    })
  );

const worldDriven = (driver: Driver) =>
  Layer.mergeAll(worldOf(scenario, "memory"), heldRuns(driver), MetricsMemory);

const world = worldDriven(drive);

const pointsSoFar = MetricsWritten.use(({ points }) => points);

const driven = HeldRuns.use(({ drive: all }) => all);

const parseIso = AskId.make("parse-iso");

const formatDate = AskId.make("format-date");

const fixedParse = "export const parse = (s) => ({ year: 2026 });\n";

interface Pushed {
  readonly eventId: string;
  readonly fork: RepoName;
  readonly from: CommitSha;
  readonly head: CommitSha;
  readonly who: Person;
}

const reportPush = (api: ProjectApi, pushed: Pushed) =>
  api.recordPush({
    after: pushed.head,
    before: Option.some(pushed.from),
    eventId: pushed.eventId,
    pusher: pushed.who,
    ref: "refs/heads/main",
    repo: pushed.fork,
  });

const journey = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  yield* api.recordFirstPush(alice, first);

  const opened = (yield* openRed(api, "parse-iso")).landed;

  yield* api.claim(bob, parseIso);

  const bobFork = forkOf("parse-iso", bob);

  const wide = yield* Pusher.use((pusher) =>
    pusher.push(
      bobFork,
      Option.some(opened),
      changed(
        changed(
          withAskFiles(start, "parse-iso"),
          "packages/parser/src/parse.ts",
          fixedParse
        ),
        "packages/format/src/format.ts",
        "export const format = (d) => d.toString();\n"
      )
    )
  );

  const widePush: Pushed = {
    eventId: "push-wide",
    fork: bobFork,
    from: opened,
    head: wide,
    who: bob,
  };

  const wideRefused = yield* reportPush(api, widePush);

  const fixedFiles = changed(
    withAskFiles(start, "parse-iso"),
    "packages/parser/src/parse.ts",
    fixedParse
  );

  const fix = yield* Pusher.use((pusher) =>
    pusher.push(bobFork, Option.some(wide), fixedFiles)
  );

  yield* reportPush(api, {
    eventId: "push-fix",
    fork: bobFork,
    from: wide,
    head: fix,
    who: bob,
  });

  yield* script(
    yield* mergedAt({
      base: opened,
      fork: bobFork,
      head: fix,
      main: opened,
      repo,
    }),
    {}
  );

  const fixAnswer = {
    ask: parseIso,
    base: opened,
    head: fix,
    requestId: RequestId.make("req-fix-0001"),
  };

  yield* api.submitAnswer(bob, fixAnswer);
  yield* advanceTo("2026-10-07T12:02:00Z");
  yield* driven;

  const landed = yield* mainTip;
  const formatOpened = (yield* openRed(api, "format-date")).landed;

  yield* api.claim(dave, formatDate);

  const daveFork = forkOf("format-date", dave);

  const broken = yield* Pusher.use((pusher) =>
    pusher.push(
      daveFork,
      Option.some(formatOpened),
      changed(
        withAskFiles(fixedFiles, "format-date"),
        "packages/format/src/format.ts",
        "export const format = (d) => ({ year: 2026 })\n"
      )
    )
  );

  yield* script(
    yield* mergedAt({
      base: formatOpened,
      fork: daveFork,
      head: broken,
      main: formatOpened,
      repo,
    }),
    { lint: "failed" }
  );
  yield* script(CheckAt.cases.Commit.make({ commit: formatOpened }), {});

  const brokenAnswer = {
    ask: formatDate,
    base: formatOpened,
    head: broken,
    requestId: RequestId.make("req-broken-0001"),
  };

  yield* api.submitAnswer(dave, brokenAnswer);
  yield* advanceTo("2026-10-07T12:05:30Z");
  yield* driven;

  return {
    api,
    brokenAnswer,
    fixAnswer,
    landed,
    points: yield* pointsSoFar,
    widePush,
    wideRefused,
  };
});

const tagged = (points: readonly MetricPoint[]) =>
  points.map((point) => point._tag);

describe("a project's metrics", () => {
  it.effect(
    "count each landing, each refusal with the stage that gave it, each checked lane, and the wait before checks",
    () =>
      Effect.gen(function* () {
        const { points, wideRefused } = yield* journey;

        const landed = MetricPoint.cases.Landed.make({ project });

        const ran = (lane: LaneName, result: "passed" | "failed" = "passed") =>
          MetricPoint.cases.LaneRan.make({
            durationMs: 1,
            lane,
            project,
            result,
          });

        expect(wideRefused.map(({ _tag }) => _tag)).toStrictEqual([
          "OutOfScope",
        ]);
        expect(points).toStrictEqual([
          // The first push, then the opening of `parse-iso`.
          landed,
          landed,
          // The wide push, refused by stage 1's shape before any answer.
          MetricPoint.cases.Refused.make({
            project,
            stage: "shape",
            tag: "OutOfScope",
          }),
          // Bob's fix: two minutes from its queueing to its checks.
          MetricPoint.cases.ChecksWaited.make({ project, waitedMs: 120_000 }),
          ran(redThenGreen),
          ran(lint),
          ran(types),
          landed,
          // The opening of `format-date`.
          landed,
          // Dave's answer, refused by its checks.
          MetricPoint.cases.ChecksWaited.make({ project, waitedMs: 210_000 }),
          ran(redThenGreen),
          ran(lint, "failed"),
          ran(types),
          MetricPoint.cases.Refused.make({
            project,
            stage: "checks",
            tag: "ChecksFailed",
          }),
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "name no path, command, log or file: a project, tags, stages, lanes and numbers alone",
    () =>
      Effect.gen(function* () {
        const { points } = yield* journey;
        const text = JSON.stringify(points);

        for (const secretish of [
          "packages/",
          ".ts",
          "run lint",
          "scripted failure",
          "req-",
          "push-",
          "--",
        ]) {
          expect(text).not.toContain(secretish);
        }
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "count each fact once when every report of every step is heard twice",
    () =>
      Effect.gen(function* () {
        const once = yield* journey.pipe(
          Effect.map(({ points }) => points),
          Effect.provide(world)
        );

        const twice = yield* journey.pipe(
          Effect.map(({ points }) => points),
          Effect.provide(worldDriven(heardTwice))
        );

        expect(twice).toStrictEqual(once);
      })
  );

  it.effect(
    "count nothing more when a push, an answer, a report or a whole run is heard again",
    () =>
      Effect.gen(function* () {
        const { api, brokenAnswer, fixAnswer, points, widePush } =
          yield* journey;

        yield* advanceTo("2026-10-07T13:00:00Z");
        yield* reportPush(api, widePush);
        yield* api.submitAnswer(bob, fixAnswer);
        yield* api.submitAnswer(dave, brokenAnswer);

        const run = Option.getOrThrow(
          yield* api.answer(brokenAnswer.requestId)
        );

        // The Workflow's last report, sent again as a retried step would.
        yield* api.advanceAnswer(
          brokenAnswer.requestId,
          LandingCommand.Checked({
            decisions: [],
            finish: run.finish,
            refusals: LandingState.guards.Refused(run.state)
              ? run.state.refusals
              : [],
            tree: Option.getOrThrow(Option.fromUndefinedOr(run.verdict?.tree)),
          }),
          { lanes: run.verdict?.lanes ?? [], stage: "checks" }
        );
        yield* driven;
        // Every run again from its first step, as a Workflow replayed whole would.
        yield* drive(api, fixAnswer.requestId);
        yield* drive(api, brokenAnswer.requestId);

        expect(tagged(yield* pointsSoFar)).toStrictEqual(tagged(points));
      }).pipe(Effect.provide(world))
  );
});

class ReadModelGate extends Context.Service<
  ReadModelGate,
  {
    /** Holds the read model's next apply until `open`. */
    readonly hold: Effect.Effect<void>;
    /** Done once the held apply has begun. */
    readonly held: Effect.Effect<void>;
    readonly open: Effect.Effect<void>;
  }
>()("test/ReadModelGate") {}

/** A read model whose next apply waits, as a settle waits on D1's. */
const gatedReadModel = Layer.effectContext(
  Effect.gen(function* () {
    const kept = yield* Layer.build(ProjectionMemory);
    const projection = Context.get(kept, Projection);
    const armed = yield* Ref.make(false);
    const reached = yield* Latch.make();
    const opened = yield* Latch.make();

    const waited = reached.open.pipe(Effect.andThen(opened.await));

    return kept.pipe(
      Context.add(Projection, {
        apply: (rows) =>
          Effect.flatMap(Ref.getAndSet(armed, false), (hold) =>
            Effect.andThen(hold ? waited : Effect.void, projection.apply(rows))
          ),
      }),
      Context.add(ReadModelGate, {
        held: reached.await,
        hold: Ref.set(armed, true),
        open: Effect.asVoid(opened.open),
      })
    );
  })
);

describe("a project's metrics, settled by a call and by the alarm at once", () => {
  it.effect(
    "count a fact once when the alarm settles its row while the call that kept it waits on the read model",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-07T12:00:00Z");

        const api = yield* projectService(project);
        const gate = yield* ReadModelGate;

        yield* api.initProject(alice, {});

        const first = yield* Pusher.use((pusher) =>
          pusher.push(repo, Option.none(), start, "Start")
        );

        yield* gate.hold;

        const call = yield* Effect.forkChild(api.recordFirstPush(alice, first));

        yield* gate.held;
        yield* api.onAlarm();
        yield* gate.open;
        yield* Fiber.join(call);

        expect(yield* pointsSoFar).toStrictEqual([
          MetricPoint.cases.Landed.make({ project }),
        ]);
      }).pipe(Effect.provide(Layer.mergeAll(world, gatedReadModel)))
  );
});

const proposal = ProposalId.make("prop-000001");

const drafted = Effect.gen(function* () {
  yield* advanceTo("2026-10-08T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  yield* api.recordFirstPush(alice, first);
  yield* api.proposeAsk(bob, {
    draft: true,
    territory: "packages/parser",
    want: "Parse an ISO week date such as 2026-W41",
  });

  return api;
});

const failedRound = DraftResult.cases.Failed.make({
  attempts: 3,
  model: "@cf/moonshotai/kimi-k2.7-code",
  refusal: new NotRedFirst({}),
});

describe("a draft round's metrics", () => {
  it.effect(
    "time the round from its start to its settle, once however often it settles",
    () =>
      Effect.gen(function* () {
        const api = yield* drafted;

        yield* advanceTo("2026-10-08T12:01:35Z");
        yield* api.draftSettled(proposal, 1, failedRound);
        yield* advanceTo("2026-10-08T12:03:00Z");
        yield* api.draftSettled(proposal, 1, failedRound);

        expect(yield* pointsSoFar).toStrictEqual([
          MetricPoint.cases.Landed.make({ project }),
          MetricPoint.cases.Drafted.make({
            attempts: 3,
            latencyMs: 95_000,
            project,
            ready: false,
          }),
        ]);
      }).pipe(Effect.provide(world))
  );
});
