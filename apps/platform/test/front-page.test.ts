import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { UpstreamRepoHost } from "@repo/git/upstream/repo-host";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRunsInline } from "@repo/project/answer-runs/inline";
import { Lander } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { FinishersFromChecks } from "@repo/project/project";
import { FrontPageD1 } from "@repo/project/projection-d1/front-page";
import { StandingPosturesD1 } from "@repo/project/projection-d1/postures";
import { ProjectionD1 } from "@repo/project/projection-d1/projection";
import { Projects } from "@repo/project/projects";
import { ProjectsMemory } from "@repo/project/projects/memory";
import type { Client } from "@repo/protocol/contracts";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  Handle,
  LandedSha,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { advanceTo, at } from "@repo/testkit/clock";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import type { Scope } from "effect";
import { Array, Context, Effect, FileSystem, Layer, Order, Path } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { WorkerFetch } from "../src/adapters/fetch.ts";
import { MemoryRateLimits, WorkerCaps } from "../src/adapters/rate-limits.ts";
import { decodeEnv, platformOn } from "../src/platform.ts";
import { serve } from "../src/surfaces.ts";
import { fakeEnv } from "./fake-env.ts";
import { seeded } from "./handlers.fixtures.ts";
import { rpcClient } from "./harness.ts";

const datekit = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "trim-input", territory: "packages/trim" })
);

const { project } = datekit;

const parseIso = AskId.make("parse-iso");

const bob = Handle.make("bob");

const alice = Handle.make("alice");

const noon = "2026-10-07T12:00:00Z";

// Comment lines go before the split: a comment may hold a `;`.
const migrated = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sql = yield* SqlClient;

    const folder = yield* path.fromFileUrl(
      new URL("../migrations", import.meta.url)
    );

    const files = Array.sort(
      (yield* fs.readDirectory(folder)).filter((file) => file.endsWith(".sql")),
      Order.String
    );

    for (const file of files) {
      const text = yield* fs.readFileString(path.join(folder, file));

      const code = text
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n");

      for (const statement of code.split(";")) {
        if (statement.trim().length > 0) {
          yield* sql.unsafe(statement);
        }
      }
    }
  })
).pipe(
  Layer.provide(NodeServices.layer),
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
  Layer.orDie
);

const redOnMainGreenOnAnswers = Layer.succeed(
  CheckRunner,
  CheckRunner.of({
    run: ({ at: where, lanes }) => {
      const passed = CheckAt.guards.Tree(where);

      return Effect.succeed({
        durationMs: lanes.length,
        evidence: passed
          ? []
          : lanes.map(({ lane }) => ({ lane, signature: `${lane}: red` })),
        heldBack: [],
        lanes: lanes.map(({ command, lane }) => ({
          command,
          durationMs: 1,
          lane,
          result: passed ? ("passed" as const) : ("failed" as const),
        })),
      });
    },
  })
);

const rules = Layer.effect(
  RulesEvaluator,
  Effect.gen(function* () {
    const finishers = yield* Finishers;
    const { policy } = datekit;

    return RulesEvaluator.of({
      call: () => Effect.succeed(false),
      evaluate: ({ at: landed, facts, modules }) =>
        Effect.succeed({
          ...policy,
          asks: policy.asks.filter(({ file }) => file in modules.modules),
          at: landed,
          judge: finishers.judgeClosure(policy.run, facts.ci),
        } satisfies Policy),
    });
  })
).pipe(Layer.provide(FinishersFromChecks));

interface FrontPageWorld {
  readonly calls: Effect.Effect<readonly string[]>;
  readonly forget: Effect.Effect<void>;
  readonly anyone: Client["Service"];
  readonly landAnswer: Effect.Effect<void>;
  readonly makeQuiet: Effect.Effect<void>;
}

const frontPageWorld: Effect.Effect<FrontPageWorld, never, Scope.Scope> =
  Effect.gen(function* () {
    const base = yield* Layer.build(
      Layer.mergeAll(
        AlarmsMemory,
        AnswerRunsInline,
        EvidenceStoreMemory,
        FrontPageD1,
        MemoryRateLimits(WorkerCaps),
        ProjectionD1,
        rules,
        StandingPosturesD1,
        UpstreamRepoHost
      ).pipe(
        Layer.provideMerge(migrated),
        Layer.provideMerge(LanderIsogit),
        Layer.provideMerge(redOnMainGreenOnAnswers),
        Layer.provideMerge(RepoHostMemory),
        Layer.provideMerge(WorkerFetch)
      )
    );

    const found = Context.get(
      yield* Layer.build(
        ProjectsMemory.pipe(Layer.provide(Layer.succeedContext(base)))
      ),
      Projects
    );

    const calls: string[] = [];

    const counted = Projects.of({
      create: (name) =>
        Effect.suspend(() => {
          calls.push(`create ${name}`);

          return found.create(name);
        }),
      get: (name) =>
        Effect.suspend(() => {
          calls.push(`get ${name}`);

          return found.get(name);
        }),
    });

    const ports = Context.add(base, Projects, counted);
    const config = yield* Effect.orDie(decodeEnv(fakeEnv()));

    const { dispose, handler } = serve(
      platformOn(config, Layer.succeedContext(ports))
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    const landAnswer = Effect.gen(function* () {
      const answerer = Person.make({ handle: bob });
      const api = yield* counted.get(project);
      const { claim } = yield* api.claim(answerer, parseIso);
      const main = LandedSha.make(claim.base);

      const { commit } = yield* Context.get(base, Lander).compose({
        files: Array.make({
          content: "export const parse = (s) => ({ year: 2026 });\n",
          path: RepoPath.make("packages/parser/src/parse.ts"),
        }),
        main,
        repo: claim.fork,
      });

      yield* api.submitAnswer(answerer, {
        ask: parseIso,
        base: main,
        head: commit,
        requestId: RequestId.make("req-parse-iso1"),
      });
    }).pipe(Effect.orDie);

    yield* seeded(datekit).pipe(Effect.provideContext(ports));

    return {
      anyone: yield* rpcClient(handler),
      calls: Effect.sync(() => [...calls]),
      forget: Effect.sync(() => {
        calls.length = 0;
      }),
      landAnswer,
      makeQuiet: seeded(aProject({ name: "quietkit" })).pipe(
        Effect.provideContext(ports)
      ),
    };
  });

describe("the project list and credits over the platform's /rpc", () => {
  it.effect(
    "lists a project that was only made and first pushed, its adoption the one event it has",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const world = yield* frontPageWorld;

        yield* world.makeQuiet;

        const { projects } = yield* world.anyone.listProjects({});

        expect(
          projects.find(({ project: listed }) => listed === "alice/quietkit")
        ).toStrictEqual({
          landedAt: at(noon),
          openAsks: 0,
          posture: "open",
          project: "alice/quietkit",
        });
      }).pipe(Effect.scoped)
  );

  it.effect(
    "after a landing, lists the project from D1, asking it only its posture and only once, and its people's credits without calling a project",
    () =>
      Effect.gen(function* () {
        yield* advanceTo(noon);

        const world = yield* frontPageWorld;

        yield* world.landAnswer;
        yield* world.forget;

        const listed = yield* world.anyone.listProjects({});
        const bobs = yield* world.anyone.credits({ handle: bob });
        const alices = yield* world.anyone.credits({ handle: alice });

        expect({
          alices,
          bobs,
          calls: yield* world.calls,
          listed,
        }).toStrictEqual({
          alices: {
            credits: [{ area: "parser", count: 1, project, role: "Asked-by" }],
          },
          bobs: {
            credits: [
              { area: "parser", count: 1, project, role: "Signed-off-by" },
            ],
          },
          calls: [`get ${project}`],
          listed: {
            projects: [
              { landedAt: at(noon), openAsks: 1, posture: "open", project },
            ],
          },
        });

        yield* world.forget;

        expect(yield* world.anyone.listProjects({})).toStrictEqual(listed);
        expect(yield* world.calls).toStrictEqual([]);
      }).pipe(Effect.scoped)
  );
});
