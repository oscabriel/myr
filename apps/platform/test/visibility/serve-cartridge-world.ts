// Run as a process: prints `{"origin":…,"kept":…}` once it serves, and serves until
// its stdin ends.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { CheckJob, CheckRunner } from "@repo/checks/check-runner";
import type { CheckRun } from "@repo/checks/check-runner";
import {
  EnvValueRow,
  EventRow,
  LedgerRow,
} from "@repo/project/project-store/rows";
import { ProjectName } from "@repo/protocol/ids";
import {
  Console,
  Effect,
  Layer,
  Logger,
  Option,
  References,
  Schema,
  Stdio,
  Stream,
} from "effect";

import { shimWorkers, worldSessions } from "../world-process.ts";
import type { PlugIn } from "../world.ts";

const keepingChecker = (jobs: CheckJob[]): Layer.Layer<CheckRunner> =>
  Layer.succeed(
    CheckRunner,
    CheckRunner.of({
      run: (job) =>
        Effect.sync((): CheckRun => {
          jobs.push(job);

          return {
            durationMs: job.lanes.length,
            evidence: job.lanes.map(({ lane }) => ({
              lane,
              signature: `${lane}: failed`,
            })),
            heldBack: [],
            lanes: job.lanes.map(({ command, lane }) => ({
              command,
              durationMs: 1,
              lane,
              result: "failed",
            })),
            outputs: job.lanes
              .filter(({ output }) => output === "stdout")
              .map(({ lane }) => ({ lane, stdout: "" })),
          };
        }),
    })
  );

const encodeJobs = Schema.encodeEffect(
  Schema.Array(Schema.Struct(CheckJob.fields))
);

const encodeStore = Schema.encodeEffect(
  Schema.Struct({
    envValues: Schema.Array(EnvValueRow),
    events: Schema.Array(EventRow),
    ledger: Schema.Array(LedgerRow),
  })
);

const isReply = (response: Response) => {
  const type = response.headers.get("content-type") ?? "";

  return (
    (type.includes("json") && !type.includes("ndjson")) ||
    type.includes("text/event-stream")
  );
};

const serve = Effect.gen(function* () {
  yield* shimWorkers;

  const sessions = yield* worldSessions;

  // Loaded after the shim: each reaches `cloudflare:workers`.
  const [
    { coreLoopWorld, listen },
    { fakeEnv, withPrivateNamespace },
    { decodeEnv },
    { live },
    { stateLive },
    { envLive },
  ] = yield* Effect.promise(() =>
    Promise.all([
      import("../world.ts"),
      import("../fake-env.ts"),
      import("../../src/platform.ts"),
      import("../../src/visibility/live.ts"),
      import("../../src/visibility/state.ts"),
      import("../../src/visibility/env.ts"),
    ])
  );

  const configOver = (aside: RepoHost["Service"]) =>
    decodeEnv(withPrivateNamespace(fakeEnv(), aside)).pipe(Effect.orDie);

  const plugIn = (aside: RepoHost["Service"]): PlugIn => ({
    project: Layer.unwrap(
      Effect.map(configOver(aside), (config) =>
        Layer.mergeAll(stateLive(config), envLive(config))
      )
    ),
    worker: Layer.unwrap(Effect.map(configOver(aside), live)),
  });

  const jobs: CheckJob[] = [];
  const bodies: string[] = [];
  const lines: string[] = [];

  const keeper = Logger.make(({ fiber, message }) => {
    const annotations = fiber.getRef(References.CurrentLogAnnotations);

    lines.push(`${JSON.stringify(message)} ${JSON.stringify(annotations)}`);
  });

  const world = yield* coreLoopWorld({
    checker: () => keepingChecker(jobs),
    plugIn,
    sessions,
  }).pipe(Effect.provide(Logger.layer([keeper], { mergeWithExisting: true })));

  const origin = yield* listen((request) =>
    Effect.gen(function* () {
      const response = yield* world.fetch(request);

      if (isReply(response)) {
        bodies.push(yield* Effect.promise(() => response.clone().text()));
      }

      return response;
    })
  );

  const keptFor = (project: ProjectName) =>
    Effect.gen(function* () {
      const logged = yield* world.logged;
      const stored = yield* world.stored(project);

      return {
        bodies,
        jobs: yield* encodeJobs(jobs),
        logged: [
          ...logged.map(
            ({ annotations, message }) =>
              `${JSON.stringify(message)} ${JSON.stringify(Object.fromEntries(annotations))}`
          ),
          ...lines,
        ],
        store: Option.isSome(stored)
          ? yield* encodeStore({
              envValues: stored.value.rows.envValues,
              events: stored.value.events,
              ledger: stored.value.rows.ledger,
            })
          : null,
      };
    }).pipe(Effect.orDie);

  const kept = yield* listen((request) =>
    Effect.gen(function* () {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/settle") {
        yield* world.settle();

        return new Response(null, { status: 204 });
      }

      const project = url.searchParams.get("project");

      if (
        request.method === "GET" &&
        url.pathname === "/kept" &&
        project !== null
      ) {
        return Response.json(yield* keptFor(ProjectName.make(project)));
      }

      return new Response(null, { status: 404 });
    })
  );

  yield* Console.log(JSON.stringify({ kept, origin }));

  const stdio = yield* Stdio.Stdio;

  yield* Stream.runDrain(stdio.stdin);
});

NodeRuntime.runMain(
  serve.pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
