/**
 * The core loop's world (spec §5, "The W3 acceptance test"): the platform's
 * fetch handler composed as the Worker composes it (`platformOn`, the
 * surfaces over the ports), served on a local port so real git reaches it.
 * The ports are the ones `workerPorts` gives the Worker, each a Node
 * adapter here:
 *
 * - `RepoHost` is W2's `/local` (bare repos in a temporary folder), whose
 *   git is real `git http-backend` on a second port, and `Upstream` is W2's
 *   `UpstreamRepoHost` over it with the Worker's fetch (Node's, here).
 * - `Projects` is `DoProjects` over an in-process `PROJECT` namespace: each
 *   name is one Project DO, 302's `projectShell` over a sqlite-node database
 *   of its own, on these ports with `Alarms` in memory and `AnswerRuns`
 *   queued in process.
 * - `CheckRunner` is W2's `/memory`, scripted by the test; `Lander` is W2's
 *   `/isogit`; `RulesEvaluator` is W2's `/bun`, over the config folder as
 *   committed; the front page, the rate limits and the evidence are kept in
 *   memory, the evidence unless the test gives the world its own store.
 *
 * `settle` carries every queued answer run: 304's `runAnswer` over the same
 * ports, its steps kept in memory, as the Answer Workflow runs it over the
 * engine's. People are `dora` (who makes the project, so its decider),
 * `alice` and `bob`, each a `SESSION_TOKENS` entry: git sends a person's
 * token as the Basic password its credential helper gives, and the RPC
 * client as a bearer token.
 *
 * Every log line the Worker's handler writes is kept beside its usual
 * printing, with its annotations (`logged`), and each Project DO's SQLite
 * stays reachable (`ratchets` reads its `ratchets` rows through the store).
 */
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
import type { RatchetRow } from "@repo/project/project-store/rows";
import { ProjectStoreSqlite } from "@repo/project/project-store/sqlite";
import { ProjectionMemory } from "@repo/project/projection/memory";
import { Contracts } from "@repo/protocol/contracts";
import type { Client } from "@repo/protocol/contracts";
import type { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import type { ConfigFile } from "@repo/protocol/domain/common";
import { CommitSha, LandedSha, RepoName } from "@repo/protocol/ids";
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
import { projectShell } from "../src/project-shell.ts";
import { serve } from "../src/surfaces.ts";
import { runAnswer } from "../src/workflows/answer/program.ts";
import { memoSteps } from "../src/workflows/step.ts";
import { fakeEnv } from "./fake-env.ts";
import { inProcessNamespace } from "./project-namespace.ts";

/** The people the world knows: one decider and two contributors. */
export type Someone = "dora" | "alice" | "bob";

/** Each person's platform token, as `SESSION_TOKENS` lists them. */
const tokens = {
  alice: "alice-core-loop-token-0123456789abcdef",
  bob: "bob-core-loop-token-0123456789abcdefghi",
  dora: "dora-core-loop-token-0123456789abcdefgh",
} as const satisfies Record<Someone, string>;

/** A person's real git: every command through their credential helper. */
export interface GitClient {
  /** git in `cwd`; a git that fails is a result, not an error. */
  readonly run: (cwd: string, ...args: readonly string[]) => Effect.Effect<Ran>;
  /** git in `cwd`, its output trimmed; a git that fails fails the test. */
  readonly ok: (
    cwd: string,
    ...args: readonly string[]
  ) => Effect.Effect<string>;
  /** Pushes the work tree's `HEAD` at `cwd` to its origin's `main`; refused or not, a result. */
  readonly push: (cwd: string) => Effect.Effect<Ran>;
  /** Clones `remote` into a folder of this person's own, named for the repo, and returns its path. */
  readonly clone: (remote: string) => Effect.Effect<string>;
  /** Writes `files` in the work tree at `cwd`, commits them all, and returns the commit. */
  readonly commit: (
    cwd: string,
    message: string,
    files: Readonly<Record<string, string>>
  ) => Effect.Effect<CommitSha>;
}

/** One line the Worker's handler logged, with its annotations as text. */
export interface Logged {
  readonly message: string;
  readonly annotations: ReadonlyMap<string, string>;
}

/** The world a core-loop test drives. */
export interface CoreLoopWorld {
  /** The platform's fetch handler, composed as the Worker's is. */
  readonly fetch: (request: Request) => Effect.Effect<Response>;
  /** Where the handler is served, on a local port, so git can reach it. */
  readonly origin: string;
  readonly git: (as: Someone) => GitClient;
  /**
   * That person's git, whose credential helper gives `username` beside
   * their token, as the CLI's helper gives a harness's audit username. One
   * such git per person in a world: its clones share a home.
   */
  readonly gitWithUsername: (
    as: Someone,
    username: string
  ) => Effect.Effect<GitClient>;
  /** Every line the Worker's handler logged so far, in order. */
  readonly logged: Effect.Effect<readonly Logged[]>;
  /** A project's ratchet baselines, as its Durable Object's store keeps them. */
  readonly ratchets: (
    project: ProjectName
  ) => Effect.Effect<readonly RatchetRow[]>;
  /** A client of the contracts over HTTP at `/rpc`, as that person (or as anyone). */
  readonly rpc: (as: Someone | "anonymous") => Client["Service"];
  /** Runs every queued answer run to its end, and any run those start. */
  readonly settle: () => Effect.Effect<void>;
  /** What the Checker answers for a lane at a commit or tree, in order. */
  readonly script: (
    at: CheckAt,
    lane: LaneName,
    results: readonly LaneOutcome[]
  ) => Effect.Effect<void>;
  /** What a count lane prints at a commit or tree: a linter's JSON, as recorded. */
  readonly print: (
    at: CheckAt,
    lane: LaneName,
    stdout: string
  ) => Effect.Effect<void>;
  /**
   * The commit the Lander composes from `files` on `project`'s main, which
   * an ask's check runs on, red first, as the ask opens.
   */
  readonly composed: (
    project: ProjectName,
    files: Array.NonEmptyReadonlyArray<ConfigFile>
  ) => Effect.Effect<CommitSha>;
}

/** How many rounds of runs starting runs `settle` takes before it gives up. */
const ROUNDS = 16;

/**
 * Serves `handle` on a local port for as long as the scope lasts, each
 * request as Node's server hands it over made a plain `Request`, and returns
 * its origin.
 */
const listen = (handle: (request: Request) => Effect.Effect<Response>) =>
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

/**
 * A credential helper as git runs one: asked for a credential, it answers
 * with a username (the person's handle, unless told another) and their
 * platform token as the password.
 */
const helperScript = (as: Someone, username: string = as) =>
  [
    "#!/bin/sh",
    'test "$1" = get || exit 0',
    `echo 'username=${username}'`,
    `echo password=${tokens[as]}`,
    "",
  ].join("\n");

/**
 * What a test may set in its world: where lane logs are kept, in memory by
 * default; the front page, which lists no project by default; the Checker,
 * W2's `/memory` scripted by the test unless given; and more people.
 */
export interface WorldOptions {
  readonly evidence?: Layer.Layer<EvidenceStore>;
  readonly frontPage?: Layer.Layer<FrontPage>;
  /**
   * The Checker, made from the folder the world's bare repos live in (each
   * repo at `<repos>/<repo>.git`), as `serve-world.ts` runs lanes for real.
   * `script` and `print` then reach nothing.
   */
  readonly checker?: (repos: string) => Layer.Layer<CheckRunner>;
  /**
   * More people beside dora, alice and bob, as `SESSION_TOKENS` lists them:
   * token to handle.
   */
  readonly sessions?: Readonly<Record<string, string>>;
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

    // Artifacts' stand-in: real git over the bare repos, taking any credential.
    const upstreamOrigin = yield* listen((request) =>
      Effect.scoped(httpBackend(repos)(request)).pipe(
        Effect.provideContext(node)
      )
    );

    // The Checker reads its script when it runs, so the test may add to it.
    const script = new Map<string, readonly LaneResult[]>();
    const printed = new Map<string, string>();
    const queued = yield* Ref.make<readonly AnswerParams[]>([]);
    // Each line the handler logs, kept with its annotations as it is written.
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

    // Every port but `Projects`, built once: the Worker's, its Project DOs'
    // and the answer runs' alike.
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

    /** A project's answer runs, queued for `settle`, as the Answer Workflow takes them. */
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

    // Each DO's database, kept so a test can read its rows back.
    const databases = new Map<string, Context.Context<SqlClient>>();

    // The `PROJECT` namespace in process: a name is one DO, made on its
    // first call, a shell over a database of its own, living in the world's
    // scope.
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
            runsOf(name)
          ),
          sql: Layer.succeedContext(sql),
        });
      })
    );

    const ports = base.pipe(
      Context.merge(yield* Layer.build(DoProjects(namespace)))
    );

    // Every request the handler serves logs through the keeper too.
    const logging = yield* Layer.build(
      Logger.layer([keeper], { mergeWithExisting: true })
    );

    // The stage's env as the Worker decodes it, with the people's tokens.
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

    // One client per person, over HTTP to the served origin.
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

    const gitOf = (
      as: Someone,
      username: string = as
    ): Effect.Effect<GitClient> =>
      Effect.gen(function* () {
        const named = username === as ? as : `${as}-named`;
        const helper = `${helpers}/${named}`;
        const home = `${root}/people/${named}`;

        yield* Effect.orDie(
          Effect.all([
            fs.writeFileString(helper, helperScript(as, username)),
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

    const gits = {
      alice: yield* gitOf("alice"),
      bob: yield* gitOf("bob"),
      dora: yield* gitOf("dora"),
    };

    /** Carries the queued runs, then the runs they started, round by round. */
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

        // Each start runs over a fresh record of steps, as a restarted
        // Workflow instance would (304's Comments, item 2).
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
          const repo = RepoName.make(project);
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
      print: (at, lane, stdout) =>
        Effect.sync(() => {
          printed.set(scriptKey(at, lane), stdout);
        }),
      ratchets: (project) =>
        Option.match(Option.fromUndefinedOr(databases.get(project)), {
          onNone: () => Effect.succeed([]),
          onSome: (sql) =>
            ProjectStore.use((store) => store.load()).pipe(
              Effect.map(({ ratchets }) => ratchets),
              Effect.provide(
                ProjectStoreSqlite.pipe(
                  Layer.provide(Layer.succeedContext(sql))
                )
              )
            ),
        }),
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
    };
  });
