/**
 * The core loop's world (`../world.ts`) with the visibility cartridge
 * plugged in as the Worker plugs it, as a process of its own that keeps
 * what it served: `bun apps/platform/test/visibility/serve-cartridge-world.ts`
 * prints one JSON line, `{"origin":"http://127.0.0.1:<port>","kept":"http://127.0.0.1:<port>"}`,
 * once it serves, and serves until its stdin ends (the process that started
 * it closed it, or died).
 *
 * - `origin` is the platform's fetch handler, as `../serve-world.ts` serves
 *   it; every body it answers with JSON or an event stream (the contracts'
 *   at `/rpc`, MCP's at `/mcp`) is kept as it went out.
 * - `kept` is a test's window on the world: `POST /settle` carries every
 *   queued answer run (`world.settle`), and `GET /kept?project=<name>`
 *   answers, as JSON, every body kept, every line logged (the handler's and
 *   each Project DO's, with their annotations), every job the Checker was
 *   given, and the project's Durable Object store as its rows encode: its
 *   `env_values` and ledger rows and its event log.
 *
 * The cartridge is the Worker's (`../../src/visibility/live.ts`) for the
 * world's stage, over the fake env's test `MASTER_KEY`, with the world's
 * second store of bare repos as the private namespace; each Project DO
 * gets its project state and its env. The Checker keeps each job and fails
 * every lane the same way, so an ask's check is red first and an answer's
 * checks run (and fail): what a job carries is what a test reads. Beside
 * dora, alice and bob, the people in `WORLD_SESSIONS` (a JSON object from
 * token to handle, as `SESSION_TOKENS` is) may call.
 *
 * A process, not an import: apps never import apps, and the CLI's
 * end-to-end `env set` test (W6 616) runs it. It lives in the cartridge
 * and goes with it. The Worker's modules import `cloudflare:workers`, which
 * this file serves from `../workers-shim.ts` through Bun's runtime plugins
 * before it loads them, as `../serve-world.ts` does.
 */
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
import { fakeArtifactsBinding } from "@repo/testkit/fake-artifacts-binding";
import {
  Config,
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

import * as shim from "../workers-shim.ts";
import type { PlugIn } from "../world.ts";

/** Bun's runtime plugins, as far as this file uses them (the platform has no Bun types). */
interface BunPlugins {
  readonly plugin: (plugin: {
    readonly name: string;
    readonly setup: (build: {
      readonly module: (
        specifier: string,
        load: () => {
          readonly exports: typeof shim;
          readonly loader: "object";
        }
      ) => void;
    }) => void;
  }) => void;
}

declare const Bun: BunPlugins;

/** `cloudflare:workers` served from the shim, for every module loaded after. */
const shimWorkers = Effect.sync(() => {
  Bun.plugin({
    name: "cloudflare-workers-shim",
    setup: (build) => {
      build.module("cloudflare:workers", () => ({
        exports: { ...shim },
        loader: "object",
      }));
    },
  });
});

/** Where the private namespace's stand-in says its repos are. */
const PRIVATE_REMOTES = "https://artifacts.private.test";

/**
 * The Checker: each job kept as it came, and every lane failed the same
 * way, a count lane printing nothing.
 */
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

const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))
);

/**
 * Each job as the Checker got it, encoded by its fields alone: without
 * `CheckJob`'s rule that only landed code carries values, so a job that
 * breaks the rule still shows, values and all, for a test to refuse.
 */
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

/**
 * Whether a response is a contract's or a tool's reply: JSON, or an MCP
 * event stream. Git's packs and adverts are not, and neither is NDJSON,
 * which only a framed `watch` gets and which never ends while it follows.
 */
const isReply = (response: Response) => {
  const type = response.headers.get("content-type") ?? "";

  return (
    (type.includes("json") && !type.includes("ndjson")) ||
    type.includes("text/event-stream")
  );
};

const serve = Effect.gen(function* () {
  yield* shimWorkers;

  const raw = yield* Config.String("WORLD_SESSIONS").pipe(
    Config.withDefault("{}")
  );

  const sessions = yield* decodeSessions(raw).pipe(
    Effect.catch(() =>
      Effect.die("WORLD_SESSIONS is not a JSON object from token to handle")
    )
  );

  // Loaded after the shim: each reaches `cloudflare:workers`.
  const [
    { coreLoopWorld, listen },
    { fakeEnv },
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

  /** The world's stage config, the second store standing in for the private namespace. */
  const configOver = (aside: RepoHost["Service"]) =>
    decodeEnv({
      ...fakeEnv(),
      ARTIFACTS_PRIVATE: fakeArtifactsBinding(aside, {
        remoteBase: PRIVATE_REMOTES,
      }),
    }).pipe(Effect.orDie);

  /**
   * The cartridge as the Worker plugs it: whole over the Worker's ports, and
   * the project service's part of it (its visibility state and its env)
   * over each Project DO's, which reach no other DO.
   */
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
  // What the Project DOs and everything else in this process logged.
  const lines: string[] = [];

  // Each line as its message and its annotations, both JSON.
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

  /** What the world kept, for `project`'s store. */
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
