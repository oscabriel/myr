/**
 * Write-only values over the platform's surfaces: the handler the
 * Worker serves, its Project DOs in process on SQLite, the platform's ports
 * in memory, and the visibility cartridge's env as the Worker composes it
 * (the real parser and the WebCrypto vault) under the fake env's test
 * `MASTER_KEY`. A decider sets datekit's token over `/rpc` with their
 * token; anyone reads the env shape over `/rpc` and sees who set it and
 * when. The value is in no response body, no log line and no event, and
 * the row the DO keeps is sealed. These tests live in the cartridge and go
 * with it.
 */
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CheckRunnerMemory } from "@repo/checks/check-runner/memory";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { Upstream } from "@repo/git/upstream";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRuns } from "@repo/project/answer-runs";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { FinishersFromChecks } from "@repo/project/project";
import { ProjectStore } from "@repo/project/project-store";
import { ProjectStoreSqlite } from "@repo/project/project-store/sqlite";
import { ProjectionMemory } from "@repo/project/projection/memory";
import { Projects } from "@repo/project/projects";
import { Contracts } from "@repo/protocol/contracts";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { Policy } from "@repo/protocol/domain/policy";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import { EnvKey, Handle, RepoName } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { NotDecider } from "@repo/protocol/refusal";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { gitClient } from "@repo/testkit/git-client";
import { aProject } from "@repo/testkit/scenarios";
import { untouchable } from "@repo/testkit/untouchable";
import { SealedValue } from "@repo/visibility/vault";
import {
  Cause,
  Context,
  Effect,
  Layer,
  Logger,
  Option,
  Redacted,
  References,
  Schema,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import type { SqlClient } from "effect/sql/SqlClient";

import { DoProjects } from "../../src/adapters/do-projects.ts";
import {
  MemoryRateLimits,
  WorkerCaps,
} from "../../src/adapters/rate-limits.ts";
import { decodeEnv, platformOn } from "../../src/platform.ts";
import { projectShell } from "../../src/project-shell.ts";
import { serve } from "../../src/surfaces.ts";
import { envLive } from "../../src/visibility/env.ts";
import { fakeEnv } from "../fake-env.ts";
import { origin } from "../harness.ts";
import { inProcessNamespace } from "../project-namespace.ts";

const scenario = aProject({ deciders: ["ines-v"], people: ["bram"] });

const { project } = scenario;

const repo = RepoName.make(project);

const token = EnvKey.make("SENTRY_AUTH_TOKEN");

/** What ines-v sets: a token-shaped value of 24 characters. */
const value = "sntrys_eyJpYXQiOjE3MjA5X";

/** Each person's platform token, as `SESSION_TOKENS` lists them. */
const tokens = {
  bram: "bram-env-values-token-0123456789abcdef",
  "ines-v": "ines-env-values-token-0123456789abcdef",
} as const;

/** datekit's `.env.schema` cut to its header, one public item and its one sensitive item. */
const datekitSchema = [
  "# @currentEnv=$APP_ENV",
  "# @defaultRequired=infer @defaultSensitive=false",
  "# ---",
  "",
  "# @type=enum(development, test, production)",
  "APP_ENV=development",
  "",
  "# Source-map upload token. Release step only; never enters a check.",
  "# @sensitive @required=forEnv(production) @tag(release)",
  '# @proxy(domain="sentry.io", path="/api/**")',
  "SENTRY_AUTH_TOKEN=",
  "",
].join("\n");

/** A `RulesEvaluator` that evaluates nothing: at any commit, the scenario's policy. */
const rules = Layer.effect(
  RulesEvaluator,
  Effect.gen(function* () {
    const finishers = yield* Finishers;

    return RulesEvaluator.of({
      call: () => Effect.succeed(false),
      evaluate: ({ at, facts }) =>
        Effect.succeed({
          ...scenario.policy,
          asks: [],
          at,
          judge: finishers.judgeClosure(scenario.policy.run, facts.ci),
        } satisfies Policy),
    });
  })
).pipe(Layer.provide(FinishersFromChecks));

/** Every line logged, with its annotations and cause, as text. */
const keeper = (logged: string[]) =>
  Logger.make(({ cause, fiber, message }) => {
    logged.push(
      [
        JSON.stringify(message),
        JSON.stringify(fiber.getRef(References.CurrentLogAnnotations)),
        Cause.pretty(cause),
      ].join(" ")
    );
  });

/** What the world kept: every response body and log line, and each DO's SQLite. */
interface Kept {
  readonly bodies: string[];
  readonly logged: string[];
  readonly databases: Map<string, Context.Context<SqlClient>>;
}

/**
 * The platform's handler over its ports, the env cartridge composed with
 * the real parser and the fake env's master key, its Project DOs in
 * process; datekit made by ines-v and its first commit landed.
 */
const world = (kept: Kept) =>
  Effect.gen(function* () {
    // The stage's env as the Worker decodes it, with the people's tokens.
    const env = {
      ...fakeEnv(),
      SESSION_TOKENS: JSON.stringify(
        Object.fromEntries(
          Object.entries(tokens).map(([handle, each]) => [each, handle])
        )
      ),
    };

    const config = yield* decodeEnv(env).pipe(Effect.orDie);

    const base = yield* Layer.build(
      Layer.mergeAll(
        LanderIsogit,
        CheckRunnerMemory.layer(new Map()),
        rules,
        EvidenceStoreMemory,
        FrontPageMemory.layer({ credits: [], entries: [], projects: [] }),
        ProjectionMemory,
        MemoryRateLimits(WorkerCaps),
        Layer.succeed(Fetch, untouchable<Fetch["Service"]>("Fetch")),
        Layer.succeed(Upstream, untouchable<Upstream["Service"]>("Upstream")),
        envLive(config)
      ).pipe(Layer.provideMerge(RepoHostMemory))
    );

    const noRuns = Layer.succeed(
      AnswerRuns,
      AnswerRuns.of({ start: () => Effect.void })
    );

    const { namespace } = yield* inProcessNamespace((name) =>
      Effect.gen(function* () {
        const sql = yield* Layer.build(
          SqliteClient.layer({ filename: ":memory:" }).pipe(Layer.orDie)
        );

        kept.databases.set(name, sql);

        return yield* projectShell({
          name,
          ports: Layer.mergeAll(
            Layer.succeedContext(base),
            AlarmsMemory,
            noRuns
          ),
          sql: Layer.succeedContext(sql),
        });
      })
    );

    const ports = Context.merge(
      base,
      yield* Layer.build(DoProjects(namespace))
    );

    const { dispose, handler } = serve(
      platformOn(config, Layer.succeedContext(ports))
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    // The handler logs through the keeper too, as the Worker's would.
    const logging = yield* Layer.build(
      Logger.layer([keeper(kept.logged)], { mergeWithExisting: true })
    );

    // ines-v makes datekit and pushes its first commit, its env schema in it.
    const ines = Person.make({ handle: Handle.make("ines-v") });
    const api = yield* Context.get(ports, Projects).create(project);
    const client = yield* gitClient(memoryFs());

    yield* api.initProject(ines, {});

    const first = yield* client.commit(
      "Start",
      [
        ["package.json", '{ "name": "datekit" }\n'],
        [".env.schema", datekitSchema],
      ],
      []
    );

    yield* Context.get(ports, RepoHost)
      .push(repo, client.source, [
        {
          from: Option.none(),
          ref: RefName.make("refs/heads/main"),
          to: first,
        },
      ])
      .pipe(Effect.orDie);

    yield* api.recordFirstPush(ines, first);

    // Every request reaches the handler as a fetch would send it, and
    // every response body is kept as it went out.
    const context = yield* Effect.context();

    const fetch: typeof globalThis.fetch = (input, init) =>
      Effect.runPromiseWith(context)(
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            handler(new Request(input, init), logging)
          );

          kept.bodies.push(
            yield* Effect.promise(() => response.clone().text())
          );

          return response;
        })
      );

    /** A client of the contracts over `/rpc`, as `who` (a bearer) or as anyone. */
    return (who?: keyof typeof tokens) =>
      RpcClient.make(Contracts).pipe(
        Effect.provide(
          RpcClient.layerProtocolHttp({
            transformClient: HttpClient.mapRequest((request) =>
              who === undefined
                ? request
                : HttpClientRequest.bearerToken(request, tokens[who])
            ),
            url: `${origin}/rpc`,
          }).pipe(
            Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
          )
        )
      );
  }).pipe(Effect.orDie);

/** The project's rows and events as its DO's SQLite keeps them. */
const storedIn = (kept: Kept) =>
  Effect.gen(function* () {
    const sql = yield* Effect.orDie(
      Effect.fromNullishOr(kept.databases.get(project))
    );

    return yield* ProjectStore.use((store) =>
      Effect.all({
        events: store.eventsSince(0, 500),
        rows: store.load(),
      })
    ).pipe(
      Effect.provide(
        ProjectStoreSqlite.pipe(Layer.provide(Layer.succeedContext(sql)))
      )
    );
  });

/**
 * bram (no decider) tries to set datekit's token, then ines-v sets it, both
 * over `/rpc` with their tokens; then anyone reads the env shape. Every
 * response body, log line and stored row and event is kept.
 */
const settingTheToken = (kept: Kept) =>
  Effect.gen(function* () {
    const clientAs = yield* world(kept);
    const ines = yield* clientAs("ines-v");
    const bram = yield* clientAs("bram");
    const anyone = yield* clientAs();

    const refused = yield* Effect.flip(
      bram.setEnv({ key: token, project, value: Redacted.make(value) })
    );

    const set = yield* ines.setEnv({
      key: token,
      project,
      value: Redacted.make(value),
    });

    return {
      refused,
      set,
      shown: yield* anyone.envShape({ project }),
      stored: yield* storedIn(kept),
    };
  }).pipe(
    Effect.provide(
      Logger.layer([keeper(kept.logged)], { mergeWithExisting: true })
    )
  );

const keptFresh = (): Kept => ({
  bodies: [],
  databases: new Map(),
  logged: [],
});

describe("a write-only value over the platform", () => {
  it.effect(
    "is set by a decider over /rpc, refused to anyone else, sealed in the DO, and shown to anyone as who and when",
    () =>
      Effect.gen(function* () {
        const { refused, set, shown, stored } =
          yield* settingTheToken(keptFresh());

        const row = stored.rows.envValues.find(({ key }) => key === token);

        const sealed = yield* Schema.decodeUnknownEffect(SealedValue)(
          row?.sealed
        );

        expect({ refused, setBy: set.setBy }).toStrictEqual({
          refused: new NotDecider({}),
          setBy: "ines-v",
        });
        expect(
          shown.items.find(({ key }) => key === token)?.value
        ).toStrictEqual({ setAt: set.setAt, setBy: "ines-v" });
        expect(Object.values(sealed).join(" ")).not.toContain(value);
        expect(
          stored.events.flatMap(({ event }) =>
            ProjectEvent.guards.LedgerAppended(event) ? [event.entry] : []
          )
        ).toStrictEqual([
          LedgerEntry.cases.ValueSet.make({
            at: set.setAt,
            by: Handle.make("ines-v"),
            key: token,
            seq: 1,
          }),
        ]);
      })
  );

  it.effect(
    "is in no response body, log line, row or event, while the set is logged by key and setter",
    () =>
      Effect.gen(function* () {
        const kept = keptFresh();
        const { stored } = yield* settingTheToken(kept);

        expect(kept.bodies.length).toBeGreaterThanOrEqual(3);
        expect(
          kept.logged.filter((line) =>
            line.includes('"a write-only value was set"')
          )
        ).toStrictEqual([
          `["a write-only value was set"] {"by":"ines-v","key":"SENTRY_AUTH_TOKEN"} `,
        ]);
        expect({
          bodies: kept.bodies.filter((body) => body.includes(value)),
          events: JSON.stringify(stored.events).includes(value),
          logged: kept.logged.filter((line) => line.includes(value)),
          rows: JSON.stringify(stored.rows).includes(value),
        }).toStrictEqual({
          bodies: [],
          events: false,
          logged: [],
          rows: false,
        });
      })
  );
});
