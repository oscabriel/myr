import { describe, expect, it } from "@effect/vitest";
import { AnswerRuns } from "@repo/project/answer-runs";
import type { AnswerQueue } from "@repo/project/answer-runs";
import { ProjectGenerator } from "@repo/project/generated";
import { RequestId } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { advanceTo, at } from "@repo/testkit/clock";
import { untouchable } from "@repo/testkit/untouchable";
import { Context, DateTime, Deferred, Effect, Layer, Option } from "effect";

import { AnswerRunsWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import type { AnswerWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import { DoBackground } from "../src/adapters/background.ts";
import { decodeEnv } from "../src/platform.ts";
import { doPorts, Project } from "../src/project-do.ts";
import { generate } from "../src/workflows/generated.ts";
import { fakeEnv } from "./fake-env.ts";
import {
  alice,
  answerWorkflow,
  anyone,
  bob,
  databaseFile,
  fixedFiles,
  forkOf,
  Instances,
  opening,
  outcomeOf,
  parseIso,
  project,
  Pusher,
  SetAlarms,
  shellOver,
  through,
  world,
} from "./project-do.fixtures.ts";

const noon = "2026-10-07T12:00:00Z";

const epochOf = (iso: string) => DateTime.toEpochMillis(at(iso));

describe("a Project DO's shell", () => {
  it.effect(
    "refuses a read of a project never made with UnknownProject, typed across the boundary",
    () =>
      Effect.gen(function* () {
        const call = through(yield* shellOver(":memory:"));

        expect(yield* outcomeOf(call("listAsks", [anyone]))).toStrictEqual({
          refused: new UnknownProject({ project }),
        });
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "persists what a call wrote, so a shell over the same SQLite hydrates it",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const file = yield* databaseFile;
        const call = through(yield* shellOver(file));
        const { ask } = yield* opening(call);
        const listed = yield* call("listAsks", [anyone]);
        const again = through(yield* shellOver(file));

        expect(listed.asks.map(({ ask: id }) => id)).toStrictEqual([ask.id]);
        expect(yield* call("listAsks", [anyone])).toStrictEqual(listed);
        expect(yield* again("listAsks", [anyone])).toStrictEqual(listed);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "sets the DO's alarm from a claim's deadline, and lapses the claim when it fires late",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const shell = yield* shellOver(":memory:");
        const call = through(shell);

        yield* opening(call);
        yield* call("claim", [bob, parseIso]);

        const alarm = yield* SetAlarms.use(({ all }) => all);

        yield* advanceTo("2026-10-08T12:00:00Z");
        yield* shell.alarm();

        const { claims } = yield* call("status", [bob]);

        expect(alarm.at(-1)).toBe(epochOf("2026-10-07T14:00:00Z"));
        expect(claims.map(({ state }) => state)).toStrictEqual(["lapsed"]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "starts one Answer Workflow instance per accepted answer, and none for its replay",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const call = through(yield* shellOver(":memory:"));
        const { landed } = yield* opening(call);

        yield* call("claim", [bob, parseIso]);

        const head = yield* Pusher.use((git) =>
          git.push(forkOf(bob), Option.some(landed), fixedFiles)
        );

        const requestId = RequestId.make("req-fix0001");
        const answer = { ask: parseIso, base: landed, head, requestId };
        const receipt = yield* call("submitAnswer", [bob, answer]);
        const startedOnce = yield* Instances.use(({ made }) => made);
        const replay = yield* call("submitAnswer", [bob, answer]);

        expect(receipt.outcome._tag).toBe("Checking");
        expect(startedOnce).toStrictEqual([
          { id: requestId, params: { project, requestId } },
        ]);
        expect(replay).toStrictEqual(receipt);
        expect(yield* Instances.use(({ made }) => made)).toStrictEqual(
          startedOnce
        );
        expect(yield* Instances.use(({ tries }) => tries)).toBe(1);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "answers a push before the Answer Workflow is admitted: the start's row stays until the start returns, an alarm meanwhile starts nothing, and the row is acked once",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const admitted = yield* Deferred.make<undefined>();
        const { instances, workflow } = answerWorkflow();
        const pending: Promise<unknown>[] = [];

        // Admission takes as long as the test says, as a Workflow's does.
        const slow: AnswerWorkflow = {
          ...workflow,
          create: (input) =>
            Effect.runPromise(
              Effect.andThen(Deferred.await(admitted), () =>
                Effect.promise(() => workflow.create(input))
              )
            ),
        };

        const host = {
          waitUntil: (promise: Promise<unknown>) => {
            pending.push(promise);
          },
        };

        const shell = yield* shellOver(":memory:").pipe(
          Effect.provide(
            Layer.mergeAll(
              AnswerRunsWorkflow(slow, project),
              Layer.succeed(Instances, instances),
              DoBackground(host)
            )
          )
        );

        const call = through(shell);
        const { landed } = yield* opening(call);

        yield* call("claim", [bob, parseIso]);

        const head = yield* Pusher.use((git) =>
          git.push(forkOf(bob), Option.some(landed), fixedFiles)
        );

        const requestId = RequestId.make("req-fix0002");
        const answer = { ask: parseIso, base: landed, head, requestId };
        const receipt = yield* call("submitAnswer", [bob, answer]);

        // The push is answered while the Workflow's admission is still awaited.
        const answered = {
          outcome: receipt.outcome._tag,
          pending: pending.length,
          tries: yield* instances.tries,
        };

        yield* shell.alarm();

        const alarmed = yield* instances.tries;

        yield* Deferred.succeed(admitted);
        yield* Effect.promise(() => Promise.all(pending));

        const made = yield* instances.made;

        yield* shell.alarm();

        const replay = yield* call("submitAnswer", [bob, answer]);

        expect(answered).toStrictEqual({
          outcome: "Checking",
          pending: 1,
          tries: 0,
        });
        expect(alarmed).toBe(0);
        expect(made).toStrictEqual([
          { id: requestId, params: { project, requestId } },
        ]);
        expect(replay).toStrictEqual(receipt);
        expect({
          restarts: yield* instances.restarts,
          tries: yield* instances.tries,
        }).toStrictEqual({ restarts: [], tries: 1 });
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "takes a nameless DO's name from the project its storage holds, and dies with neither",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const file = yield* databaseFile;
        const empty = through(yield* shellOver(":memory:", Option.none()));

        expect(yield* outcomeOf(empty("listAsks", [anyone]))).toBe("died");

        const call = through(yield* shellOver(file));
        const { ask } = yield* opening(call);
        const listed = yield* call("listAsks", [anyone]);
        const nameless = through(yield* shellOver(file, Option.none()));

        expect(listed.asks.map(({ ask: id }) => id)).toStrictEqual([ask.id]);
        expect(yield* outcomeOf(nameless("listAsks", [anyone]))).toStrictEqual({
          value: listed,
        });
      }).pipe(Effect.provide(world))
  );

  it.effect("wakes a DO no project was made in without failing", () =>
    Effect.gen(function* () {
      const shell = yield* shellOver(":memory:");

      yield* shell.alarm();

      expect(yield* outcomeOf(through(shell)("status", [alice]))).toStrictEqual(
        { refused: new UnknownProject({ project }) }
      );
    }).pipe(Effect.provide(world))
  );
});

const refused = () => Promise.reject(new Error("Workflows are down"));

describe("the Answer Workflow as AnswerRuns", () => {
  const queue = untouchable<AnswerQueue>("AnswerQueue");

  it.effect("makes one instance for a request started twice", () =>
    Effect.gen(function* () {
      const { instances, workflow } = answerWorkflow();
      const requestId = RequestId.make("req-twice0001");

      const runs = yield* AnswerRuns.pipe(
        Effect.provide(AnswerRunsWorkflow(workflow, project))
      );

      yield* runs.start(requestId, queue);
      yield* runs.start(requestId, queue);

      expect(yield* instances.made).toStrictEqual([
        { id: requestId, params: { project, requestId } },
      ]);
      expect(yield* instances.tries).toBe(2);
    })
  );

  it.effect(
    "runs an instance again when its run has ended, and leaves a live one alone",
    () =>
      Effect.gen(function* () {
        const { instances, workflow } = answerWorkflow();
        const live = RequestId.make("req-live0001");

        const ended = [
          RequestId.make("req-done0001"),
          RequestId.make("req-fail0001"),
          RequestId.make("req-stop0001"),
        ] as const;

        const runs = yield* AnswerRuns.pipe(
          Effect.provide(AnswerRunsWorkflow(workflow, project))
        );

        yield* Effect.forEach([live, ...ended], (id) => runs.start(id, queue));
        yield* instances.end(live, "waiting");
        yield* instances.end(ended[0], "complete");
        yield* instances.end(ended[1], "errored");
        yield* instances.end(ended[2], "terminated");
        yield* Effect.forEach([live, ...ended], (id) => runs.start(id, queue));

        expect({
          made: (yield* instances.made).length,
          restarts: yield* instances.restarts,
        }).toStrictEqual({ made: 4, restarts: [...ended] });
      })
  );

  it.effect(
    "dies when the Workflow can neither make nor find the instance",
    () =>
      Effect.gen(function* () {
        const runs = yield* AnswerRuns.pipe(
          Effect.provide(
            AnswerRunsWorkflow({ create: refused, get: refused }, project)
          )
        );

        expect(
          yield* outcomeOf(runs.start(RequestId.make("req-down0001"), queue))
        ).toBe("died");
      })
  );
});

describe("the Project DO class", () => {
  it("has call and alarm, and the hibernation API for its watchers: every project call goes through call", () => {
    expect(
      Object.getOwnPropertyNames(Project.prototype).toSorted()
    ).toStrictEqual([
      "alarm",
      "call",
      "constructor",
      "fetch",
      "webSocketClose",
      "webSocketMessage",
    ]);
  });

  it.effect(
    "runs on ports that carry the platform's generator, so a landing that changes the config is followed",
    () =>
      Effect.gen(function* () {
        const config = yield* decodeEnv(fakeEnv()).pipe(Effect.orDie);

        const ports = yield* Layer.build(
          doPorts({
            config,
            host: untouchable("host"),
            name: Option.some(project),
            storage: untouchable("storage"),
          })
        );

        expect(Context.get(ports, ProjectGenerator)).toBe(generate);
      })
  );
});
