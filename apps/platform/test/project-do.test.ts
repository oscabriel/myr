import { describe, expect, it } from "@effect/vitest";
import { AnswerRuns } from "@repo/project/answer-runs";
import type { AnswerQueue } from "@repo/project/answer-runs";
import { RequestId } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { advanceTo, at } from "@repo/testkit/clock";
import { untouchable } from "@repo/testkit/untouchable";
import { DateTime, Effect, Option } from "effect";

import { AnswerRunsWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import { Project } from "../src/project-do.ts";
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
        // The replay never reached the Workflow: one start, not a second the binding refused.
        expect(yield* Instances.use(({ tries }) => tries)).toBe(1);
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

/** A Workflow binding that is down: it neither makes nor finds an instance. */
const refused = () => Promise.reject(new Error("Workflows are down"));

describe("the Answer Workflow as AnswerRuns", () => {
  /** A queue the Workflow adapter never touches: the instance reaches the DO itself. */
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
  it("has only call and alarm: every project call goes through call", () => {
    expect(
      Object.getOwnPropertyNames(Project.prototype).toSorted()
    ).toStrictEqual(["alarm", "call", "constructor"]);
  });
});
