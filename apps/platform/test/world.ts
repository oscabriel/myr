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
 *   memory.
 *
 * `settle` carries every queued answer run: 304's `runAnswer` over the same
 * ports, its steps kept in memory, as the Answer Workflow runs it over the
 * engine's. People are `dora` (who makes the project, so its decider),
 * `alice` and `bob`, each a `SESSION_TOKENS` entry: git sends a person's
 * token as the Basic password its credential helper gives, and the RPC
 * client as a bearer token.
 */
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostLocal } from "@repo/artifacts/repo-host/local";
import type { CheckAt } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { UpstreamRepoHost } from "@repo/git/upstream/repo-host";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRuns } from "@repo/project/answer-runs";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { Lander } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { FinishersFromChecks } from "@repo/project/project";
import { ProjectionMemory } from "@repo/project/projection/memory";
import { Contracts } from "@repo/protocol/contracts";
import type { Client } from "@repo/protocol/contracts";
import type { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import type { ConfigFile } from "@repo/protocol/domain/common";
import {
  CommitSha,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import type { LaneName } from "@repo/protocol/ids";
import { RulesEvaluatorBun } from "@repo/rules/rules-evaluator/bun";
import { git } from "@repo/testkit/git";
import type { Ran } from "@repo/testkit/git";
import { httpBackend } from "@repo/testkit/http-backend";
import { untouchable } from "@repo/testkit/untouchable";
import type { Scope } from "effect";
import {
  Array,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Ref,
  SynchronizedRef,
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

import { DoProjects } from "../src/adapters/do-projects.ts";
import type { ProjectNamespace } from "../src/adapters/do-projects.ts";
import { WorkerFetch } from "../src/adapters/fetch.ts";
import { MemoryRateLimits, WorkerCaps } from "../src/adapters/rate-limits.ts";
import type { AnswerParams } from "../src/answer-runs.ts";
import { decodeEnv, platformOn } from "../src/platform.ts";
import { projectShell } from "../src/project-shell.ts";
import type { ProjectShell } from "../src/project-shell.ts";
import { serve } from "../src/surfaces.ts";
import { runAnswer } from "../src/workflows/answer/program.ts";
import { memoSteps } from "../src/workflows/step.ts";
import { fakeEnv } from "./fake-env.ts";

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

/** The world a core-loop test drives. */
export interface CoreLoopWorld {
  /** The platform's fetch handler, composed as the Worker's is. */
  readonly fetch: (request: Request) => Effect.Effect<Response>;
  /** Where the handler is served, on a local port, so git can reach it. */
  readonly origin: string;
  readonly git: (as: Someone) => GitClient;
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
 * with the person's handle and their platform token as the password.
 */
const helperScript = (as: Someone) =>
  [
    "#!/bin/sh",
    'test "$1" = get || exit 0',
    `echo username=${as}`,
    `echo password=${tokens[as]}`,
    "",
  ].join("\n");

export const coreLoopWorld = (): Effect.Effect<
  CoreLoopWorld,
  never,
  Scope.Scope
> =>
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
    const queued = yield* Ref.make<readonly AnswerParams[]>([]);

    // Every port but `Projects`, built once: the Worker's, its Project DOs'
    // and the answer runs' alike.
    const base = yield* Layer.build(
      Layer.mergeAll(
        UpstreamRepoHost,
        LanderIsogit,
        CheckRunnerMemory.layer(script),
        RulesEvaluatorBun.pipe(Layer.provide(FinishersFromChecks)),
        EvidenceStoreMemory,
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
        Layer.provide(NodeServices.layer)
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

    // What each DO's calls run with: the world's scope, which its shell lives in.
    const runtime = yield* Effect.context<Scope.Scope>();

    const shells = yield* SynchronizedRef.make<
      ReadonlyMap<string, ProjectShell>
    >(new Map());

    /** A project's DO, made on its first call: a shell over a database of its own. */
    const shellOf = (name: string) =>
      SynchronizedRef.modifyEffect(shells, (all) =>
        Option.match(Option.fromUndefinedOr(all.get(name)), {
          onNone: () =>
            Effect.map(
              projectShell({
                name: ProjectName.make(name),
                ports: Layer.mergeAll(
                  Layer.succeedContext(base),
                  AlarmsMemory,
                  runsOf(ProjectName.make(name))
                ),
                sql: SqliteClient.layer({ filename: ":memory:" }).pipe(
                  Layer.orDie
                ),
              }),
              (shell) => [shell, new Map(all).set(name, shell)] as const
            ),
          onSome: (shell) => Effect.succeed([shell, all] as const),
        })
      );

    // The `PROJECT` namespace in process: a name is one DO, reached by its
    // stub's `call`, which runs on the world's own runtime.
    const namespace: ProjectNamespace = {
      get: (id) => ({
        call: (request) =>
          Effect.runPromiseWith(runtime)(
            Effect.flatMap(shellOf(id.toString()), (shell) =>
              shell.call(request)
            )
          ),
      }),
      idFromName: (name) =>
        untouchable<DurableObjectId>("DurableObjectId", {
          equals: (other) => other.toString() === name,
          name,
          toString: () => name,
        }),
    };

    const ports = base.pipe(
      Context.merge(yield* Layer.build(DoProjects(namespace)))
    );

    // The stage's env as the Worker decodes it, with the people's tokens.
    const env = {
      ...fakeEnv(),
      SESSION_TOKENS: JSON.stringify(
        Object.fromEntries(
          Object.entries(tokens).map(([who, token]) => [token, who])
        )
      ),
    };

    const config = yield* decodeEnv(env).pipe(Effect.orDie);

    const { dispose, handler } = serve(
      platformOn(config, Layer.succeedContext(ports))
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    const origin = yield* listen((request) =>
      Effect.promise(() => handler(request))
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

    const gitOf = (as: Someone): Effect.Effect<GitClient> =>
      Effect.gen(function* () {
        const helper = `${helpers}/${as}`;
        const home = `${root}/people/${as}`;

        yield* Effect.orDie(
          Effect.all([
            fs.writeFileString(helper, helperScript(as)),
            fs.chmod(helper, 0o700),
            fs.makeDirectory(home, { recursive: true }),
          ])
        );

        const run = (cwd: string, ...args: readonly string[]) =>
          git(cwd, "-c", `credential.helper=${helper}`, ...args).pipe(
            Effect.provideContext(node)
          );

        const ok = (cwd: string, ...args: readonly string[]) =>
          Effect.flatMap(run(cwd, ...args), (ran) =>
            ran.exitCode === 0
              ? Effect.succeed(ran.stdout.trim())
              : Effect.die(
                  `${as}: git ${args.join(" ")} exited ${ran.exitCode}: ${ran.stderr}`
                )
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
      fetch: (request) => Effect.promise(() => handler(request)),
      git: (as) => gits[as],
      origin,
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
