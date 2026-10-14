import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostLocal } from "@repo/artifacts/repo-host/local";
import type { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import type { EvidenceStore } from "@repo/checks/evidence-store";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { UpstreamRepoHost } from "@repo/git/upstream/repo-host";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRuns } from "@repo/project/answer-runs";
import type { FrontPage } from "@repo/project/front-page";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { Lander } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { FinishersFromChecks } from "@repo/project/project";
import { ProjectStore } from "@repo/project/project-store";
import type { ProjectSnapshot } from "@repo/project/project-store";
import type { EventRow, RatchetRow } from "@repo/project/project-store/rows";
import { ProjectStoreSqlite } from "@repo/project/project-store/sqlite";
import { ProjectionMemory } from "@repo/project/projection/memory";
import type { Projects } from "@repo/project/projects";
import { Contracts } from "@repo/protocol/contracts";
import type { Client } from "@repo/protocol/contracts";
import type { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import type { ConfigFile } from "@repo/protocol/domain/common";
import { CommitSha, keyOf, LandedSha, RepoName } from "@repo/protocol/ids";
import type { LaneName, ProjectName } from "@repo/protocol/ids";
import { RulesEvaluatorBun } from "@repo/rules/rules-evaluator/bun";
import { git, gitOk } from "@repo/testkit/git";
import type { Ran } from "@repo/testkit/git";
import { httpBackend } from "@repo/testkit/http-backend";
import type { Scope } from "effect";
import {
  Array,
  Context,
  Effect,
  FileSystem,
  Layer,
  Logger,
  Option,
  Ref,
  References,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import type { SqlClient } from "effect/sql/SqlClient";

import { DoProjects } from "../src/adapters/do-projects.ts";
import { WorkerFetch } from "../src/adapters/fetch.ts";
import { MemoryRateLimits, WorkerCaps } from "../src/adapters/rate-limits.ts";
import type { AnswerParams } from "../src/answer-runs.ts";
import { decodeEnv, platformOn } from "../src/platform.ts";
import type { WorkerPorts } from "../src/ports.ts";
import { projectShell } from "../src/project-shell.ts";
import { serve } from "../src/surfaces.ts";
import { runAnswer } from "../src/workflows/answer/program.ts";
import { memoSteps } from "../src/workflows/step.ts";
import { fakeEnv } from "./fake-env.ts";
import { inProcessNamespace } from "./project-namespace.ts";

export type Someone = "dora" | "alice" | "bob";

const tokens = {
  alice: "alice-core-loop-token-0123456789abcdef",
  bob: "bob-core-loop-token-0123456789abcdefghi",
  dora: "dora-core-loop-token-0123456789abcdefgh",
} as const satisfies Record<Someone, string>;

export interface GitClient {
  readonly run: (cwd: string, ...args: readonly string[]) => Effect.Effect<Ran>;
  readonly ok: (
    cwd: string,
    ...args: readonly string[]
  ) => Effect.Effect<string>;
  readonly push: (cwd: string) => Effect.Effect<Ran>;
  readonly clone: (remote: string) => Effect.Effect<string>;
  readonly commit: (
    cwd: string,
    message: string,
    files: Readonly<Record<string, string>>
  ) => Effect.Effect<CommitSha>;
}

export interface Person {
  readonly git: GitClient;
  readonly rpc: Client["Service"];
}

export type ProjectDoPorts = Exclude<WorkerPorts, Projects>;

export interface PlugIn {
  readonly worker?: Layer.Layer<never, never, WorkerPorts>;
  readonly project?: Layer.Layer<never, never, ProjectDoPorts>;
}

export interface Logged {
  readonly message: string;
  readonly annotations: ReadonlyMap<string, string>;
}

export interface CoreLoopWorld {
  readonly fetch: (request: Request) => Effect.Effect<Response>;
  readonly origin: string;
  readonly git: (as: Someone) => GitClient;
  readonly gitWithUsername: (
    as: Someone,
    username: string
  ) => Effect.Effect<GitClient>;
  readonly logged: Effect.Effect<readonly Logged[]>;
  readonly ratchets: (
    project: ProjectName
  ) => Effect.Effect<readonly RatchetRow[]>;
  readonly stored: (project: ProjectName) => Effect.Effect<
    Option.Option<{
      readonly rows: ProjectSnapshot;
      readonly events: readonly EventRow[];
    }>
  >;
  readonly rpc: (as: Someone | "anonymous") => Client["Service"];
  readonly person: (handle: string) => Effect.Effect<Person>;
  readonly settle: () => Effect.Effect<void>;
  readonly script: (
    at: CheckAt,
    lane: LaneName,
    results: readonly LaneOutcome[]
  ) => Effect.Effect<void>;
  readonly print: (
    at: CheckAt,
    lane: LaneName,
    stdout: string
  ) => Effect.Effect<void>;
  readonly composed: (
    project: ProjectName,
    files: Array.NonEmptyReadonlyArray<ConfigFile>
  ) => Effect.Effect<CommitSha>;
}

const ROUNDS = 16;

export const listen = (handle: (request: Request) => Effect.Effect<Response>) =>
  Effect.gen(function* () {
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const web = yield* HttpServerRequest.toWeb(request);

      return HttpServerResponse.fromWeb(yield* handle(web));
    });

    const served = yield* Layer.build(
      HttpServer.serve(Effect.orDie(app)).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest)
      )
    ).pipe(Effect.orDie);

    const { address } = Context.get(served, HttpServer.HttpServer);

    if (!("port" in address)) {
      return yield* Effect.die("the server listens on a unix socket");
    }

    return `http://127.0.0.1:${address.port}`;
  });

const helperScript = (token: string, username: string) =>
  [
    "#!/bin/sh",
    'test "$1" = get || exit 0',
    `echo 'username=${username}'`,
    `echo password=${token}`,
    "",
  ].join("\n");

export interface WorldOptions {
  readonly evidence?: Layer.Layer<EvidenceStore>;
  readonly frontPage?: Layer.Layer<FrontPage>;
  readonly checker?: (repos: string) => Layer.Layer<CheckRunner>;
  readonly sessions?: Readonly<Record<string, string>>;
  readonly plugIn?: (aside: RepoHost["Service"]) => PlugIn;
}

export const coreLoopWorld = (
  options: WorldOptions = {}
): Effect.Effect<CoreLoopWorld, never, Scope.Scope> =>
  Effect.gen(function* () {
    const node = yield* Layer.build(NodeServices.layer);
    const fs = Context.get(node, FileSystem.FileSystem);
    const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
    const repos = `${root}/repos`;

    yield* fs.makeDirectory(repos, { recursive: true }).pipe(Effect.orDie);

    const upstreamOrigin = yield* listen((request) =>
      Effect.scoped(httpBackend(repos)(request)).pipe(
        Effect.provideContext(node)
      )
    );

    // The Checker reads its script when it runs, so the test may add to it.
    const script = new Map<string, readonly LaneResult[]>();
    const printed = new Map<string, string>();
    const queued = yield* Ref.make<readonly AnswerParams[]>([]);
    const logs: Logged[] = [];

    const keeper = Logger.make(({ fiber, message }) => {
      logs.push({
        annotations: new Map(
          Object.entries(fiber.getRef(References.CurrentLogAnnotations)).map(
            ([key, value]) => [key, String(value)]
          )
        ),
        message: String(message),
      });
    });

    const base = yield* Layer.build(
      Layer.mergeAll(
        UpstreamRepoHost,
        LanderIsogit,
        options.checker?.(repos) ?? CheckRunnerMemory.layer(script, printed),
        RulesEvaluatorBun.pipe(Layer.provide(FinishersFromChecks)),
        options.evidence ?? EvidenceStoreMemory,
        options.frontPage ??
          FrontPageMemory.layer({ credits: [], entries: [], projects: [] }),
        ProjectionMemory,
        MemoryRateLimits(WorkerCaps)
      ).pipe(
        Layer.provideMerge(
          RepoHostLocal.layer({
            remoteBase: `${upstreamOrigin}/git`,
            root: repos,
          })
        ),
        Layer.provideMerge(WorkerFetch),
        Layer.provide(Layer.succeedContext(node))
      )
    );

    const plugged = yield* Option.match(
      Option.fromUndefinedOr(options.plugIn),
      {
        onNone: () => Effect.succeed<PlugIn>({}),
        onSome: (plugIn) =>
          Effect.gen(function* () {
            const aside = `${root}/aside`;

            yield* fs
              .makeDirectory(aside, { recursive: true })
              .pipe(Effect.orDie);

            const asideOrigin = yield* listen((request) =>
              Effect.scoped(httpBackend(aside)(request)).pipe(
                Effect.provideContext(node)
              )
            );

            const store = yield* Layer.build(
              RepoHostLocal.layer({
                remoteBase: `${asideOrigin}/git`,
                root: aside,
              }).pipe(Layer.provide(WorkerFetch))
            );

            return plugIn(Context.get(store, RepoHost));
          }),
      }
    );

    const runsOf = (project: ProjectName) =>
      Layer.succeed(
        AnswerRuns,
        AnswerRuns.of({
          start: (requestId) =>
            Ref.update(queued, (all) =>
              all.some((each) => each.requestId === requestId)
                ? all
                : [...all, { project, requestId }]
            ),
        })
      );

    const databases = new Map<string, Context.Context<SqlClient>>();

    const readStore = <A>(
      project: ProjectName,
      read: (store: ProjectStore["Service"]) => Effect.Effect<A>
    ): Effect.Effect<Option.Option<A>> =>
      Option.match(Option.fromUndefinedOr(databases.get(project)), {
        onNone: () => Effect.succeedNone,
        onSome: (sql) =>
          ProjectStore.use(read).pipe(
            Effect.asSome,
            Effect.provide(
              ProjectStoreSqlite.pipe(Layer.provide(Layer.succeedContext(sql)))
            )
          ),
      });

    const { namespace } = yield* inProcessNamespace((name) =>
      Effect.gen(function* () {
        const sql = yield* Layer.build(
          SqliteClient.layer({ filename: ":memory:" }).pipe(Layer.orDie)
        );

        databases.set(name, sql);

        return yield* projectShell({
          name,
          ports: Layer.mergeAll(
            Layer.succeedContext(base),
            AlarmsMemory,
            runsOf(name),
            (plugged.project ?? Layer.empty).pipe(
              Layer.provide(Layer.succeedContext(base))
            )
          ),
          sql: Layer.succeedContext(sql),
        });
      })
    );

    const core = base.pipe(
      Context.merge(
        yield* Layer.build(
          DoProjects(namespace).pipe(Layer.provide(Layer.succeedContext(base)))
        )
      )
    );

    const ports = core.pipe(
      Context.merge(
        yield* Layer.build(
          (plugged.worker ?? Layer.empty).pipe(
            Layer.provide(Layer.succeedContext(core))
          )
        )
      )
    );

    const logging = yield* Layer.build(
      Logger.layer([keeper], { mergeWithExisting: true })
    );

    const env = {
      ...fakeEnv(),
      SESSION_TOKENS: JSON.stringify({
        ...Object.fromEntries(
          Object.entries(tokens).map(([who, token]) => [token, who])
        ),
        ...options.sessions,
      }),
    };

    const config = yield* decodeEnv(env).pipe(Effect.orDie);

    const { dispose, handler } = serve(
      platformOn(config, Layer.succeedContext(ports))
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    const origin = yield* listen((request) =>
      Effect.promise(() => handler(request, logging))
    );

    const clientOf = (token: Option.Option<string>) =>
      RpcClient.make(Contracts).pipe(
        Effect.provide(
          RpcClient.layerProtocolHttp({
            transformClient: HttpClient.mapRequest((request) =>
              Option.match(token, {
                onNone: () => request,
                onSome: (bearer) =>
                  HttpClientRequest.bearerToken(request, bearer),
              })
            ),
            url: `${origin}/rpc`,
          }).pipe(
            Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
          )
        )
      );

    const clients = {
      alice: yield* clientOf(Option.some(tokens.alice)),
      anonymous: yield* clientOf(Option.none()),
      bob: yield* clientOf(Option.some(tokens.bob)),
      dora: yield* clientOf(Option.some(tokens.dora)),
    };

    const helpers = `${root}/helpers`;

    yield* fs.makeDirectory(helpers, { recursive: true }).pipe(Effect.orDie);

    const gitFor = (
      named: string,
      token: string,
      username: string
    ): Effect.Effect<GitClient> =>
      Effect.gen(function* () {
        const helper = `${helpers}/${named}`;
        const home = `${root}/people/${named}`;

        yield* Effect.orDie(
          Effect.all([
            fs.writeFileString(helper, helperScript(token, username)),
            fs.chmod(helper, 0o700),
            fs.makeDirectory(home, { recursive: true }),
          ])
        );

        const run = (cwd: string, ...args: readonly string[]) =>
          git(cwd, "-c", `credential.helper=${helper}`, ...args).pipe(
            Effect.provideContext(node)
          );

        const ok = (cwd: string, ...args: readonly string[]) =>
          gitOk(cwd, "-c", `credential.helper=${helper}`, ...args).pipe(
            Effect.provideContext(node)
          );

        return {
          clone: (remote) =>
            Effect.gen(function* () {
              const name = remote
                .split("/")
                .at(-1)
                ?.replace(/\.git$/u, "");

              const into = `${home}/${name ?? "repo"}`;

              yield* ok(home, "clone", "--quiet", remote, into);

              return into;
            }),
          commit: (cwd, message, files) =>
            Effect.gen(function* () {
              for (const [path, content] of Object.entries(files)) {
                const folder = path.split("/").slice(0, -1).join("/");

                if (folder !== "") {
                  yield* fs
                    .makeDirectory(`${cwd}/${folder}`, { recursive: true })
                    .pipe(Effect.orDie);
                }

                yield* fs
                  .writeFileString(`${cwd}/${path}`, content)
                  .pipe(Effect.orDie);
              }

              yield* ok(cwd, "add", "--all");
              yield* ok(cwd, "commit", "--quiet", "--message", message);

              return CommitSha.make(yield* ok(cwd, "rev-parse", "HEAD"));
            }),
          ok,
          push: (cwd) => run(cwd, "push", "origin", "HEAD:main"),
          run,
        };
      });

    const gitOf = (as: Someone, username: string = as) =>
      gitFor(username === as ? as : `${as}-named`, tokens[as], username);

    const gits = {
      alice: yield* gitOf("alice"),
      bob: yield* gitOf("bob"),
      dora: yield* gitOf("dora"),
    };

    const people = new Map(
      yield* Effect.forEach(
        Object.entries(options.sessions ?? {}),
        ([token, handle]) =>
          Effect.map(
            Effect.all({
              git: gitFor(handle, token, handle),
              rpc: clientOf(Option.some(token)),
            }),
            (person): readonly [string, Person] => [handle, person]
          )
      )
    );

    const carry = (round: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const due = yield* Ref.getAndSet(queued, []);

        if (!Array.isReadonlyArrayNonEmpty(due)) {
          return yield* Effect.void;
        }

        if (round >= ROUNDS) {
          return yield* Effect.die(
            `answer runs were still starting each other after ${ROUNDS} rounds`
          );
        }

        yield* Effect.forEach(
          due,
          (params) =>
            Effect.flatMap(memoSteps(), (steps) =>
              runAnswer(params).pipe(
                Effect.provide(Layer.merge(Layer.succeedContext(ports), steps))
              )
            ),
          { discard: true }
        );

        return yield* carry(round + 1);
      });

    return {
      composed: (project, files) =>
        Effect.gen(function* () {
          const repo = RepoName.make(keyOf(project));
          const refs = yield* Context.get(base, RepoHost).refs(repo);

          const main = yield* Effect.fromNullishOr(
            refs.get(RefName.make("refs/heads/main"))
          );

          const { commit } = yield* Context.get(base, Lander).compose({
            files,
            main: LandedSha.make(main),
            repo,
          });

          return commit;
        }).pipe(Effect.orDie),
      fetch: (request) => Effect.promise(() => handler(request, logging)),
      git: (as) => gits[as],
      gitWithUsername: gitOf,
      logged: Effect.sync(() => [...logs]),
      origin,
      person: (handle) =>
        Option.match(Option.fromUndefinedOr(people.get(handle)), {
          onNone: () =>
            Effect.die(`the world has no ${handle}: name them in its sessions`),
          onSome: Effect.succeed,
        }),
      print: (at, lane, stdout) =>
        Effect.sync(() => {
          printed.set(scriptKey(at, lane), stdout);
        }),
      ratchets: (project) =>
        Effect.map(
          readStore(project, (store) => store.load()),
          Option.match({
            onNone: () => [],
            onSome: ({ ratchets }) => ratchets,
          })
        ),
      rpc: (as) => clients[as],
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
      settle: () => carry(0),
      stored: (project) =>
        readStore(project, (store) =>
          Effect.all({
            events: store.eventsSince(0, Number.MAX_SAFE_INTEGER),
            rows: store.load(),
          })
        ),
    };
  });
