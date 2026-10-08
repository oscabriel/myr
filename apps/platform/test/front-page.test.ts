/**
 * The project list and a person's credits as the platform serves them, over
 * a Node platform world: the platform's fetch handler composed as the
 * Worker composes it (`platformOn`), on the ports `workerPorts` gives it,
 * each a Node adapter. The front page and its projection are the D1
 * cartridge (`FrontPageD1`, `ProjectionD1`) over sqlite-node with the
 * platform's D1 migrations applied from their files; each project is a
 * project service in memory (`ProjectsMemory`) whose outbox feeds that
 * projection; the Lander is the `/isogit` one over `RepoHostMemory`; and the
 * Checker fails every lane on a commit of main (an ask's check, red first)
 * and passes every lane on an answer's merged tree. The world's `Projects`
 * counts every call, so a test shows which reads never reach a project.
 */
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

/** datekit: alice decides and asks; bob is vouched for. */
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

/**
 * The platform's D1 database: every migration in its own folder, in
 * file-name order as `wrangler d1 migrations apply` runs them, statement by
 * statement. Comment lines go before the split: a comment may hold a `;`
 * (`0002_accounts.sql`'s does).
 */
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

/**
 * An ask's check fails on a commit of main, every time the same way, and
 * every lane passes on an answer's merged tree.
 */
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

/** At any commit, datekit's policy, holding the asks whose files the commit has. */
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

/** The world a front-page test drives. */
interface FrontPageWorld {
  /** Every call the platform made to a project through `Projects`, in order. */
  readonly calls: Effect.Effect<readonly string[]>;
  /** Forgets the calls made so far. */
  readonly forget: Effect.Effect<void>;
  /** A client of the contracts over HTTP at `/rpc`, as anyone. */
  readonly anyone: Client["Service"];
  /** bob's answer to `parse-iso` landed, as his claim, push and submission make it. */
  readonly landAnswer: Effect.Effect<void>;
}

const frontPageWorld: Effect.Effect<FrontPageWorld, never, Scope.Scope> =
  Effect.gen(function* () {
    // Every port but `Projects`, built once: the Worker's and each project's.
    const base = yield* Layer.build(
      Layer.mergeAll(
        AlarmsMemory,
        AnswerRunsInline,
        EvidenceStoreMemory,
        FrontPageD1,
        MemoryRateLimits(WorkerCaps),
        ProjectionD1,
        rules,
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
    };
  });

describe("the project list and credits over the platform's /rpc", () => {
  it.effect(
    "after a landing, lists the project and its people's credits from D1 without calling a project",
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
          calls: [],
          listed: {
            projects: [
              { landedAt: at(noon), openAsks: 1, posture: "open", project },
            ],
          },
        });
      }).pipe(Effect.scoped)
  );
});
