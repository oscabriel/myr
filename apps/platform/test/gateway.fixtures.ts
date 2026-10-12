import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostLocal } from "@repo/artifacts/repo-host/local";
import { CheckAt } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import { UpstreamRepoHost } from "@repo/git/upstream/repo-host";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRuns } from "@repo/project/answer-runs";
import { Lander } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { FinishersFromChecks } from "@repo/project/project";
import type { ProjectApi } from "@repo/project/project";
import { ProjectionMemory } from "@repo/project/projection/memory";
import { Projects } from "@repo/project/projects";
import { ProjectsMemory } from "@repo/project/projects/memory";
import type { LaneResult } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  CommitSha,
  Handle,
  LaneName,
  RepoName,
  keyOf,
  addressOfRepo,
  RepoPath,
} from "@repo/protocol/ids";
import type { LandedSha, ProjectName, RequestId } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { gitOk } from "@repo/testkit/git";
import { httpBackend } from "@repo/testkit/http-backend";
import type { Scenario } from "@repo/testkit/scenarios";
import {
  Array,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Ref,
} from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";

import { WorkerFetch } from "../src/adapters/fetch.ts";
import { serveGit } from "../src/git.ts";
import { MemorySessions } from "../src/sessions/memory.ts";

export const tokens = {
  alice: "alice-platform-token-0123456789abcdef",
  bob: "bob-platform-token-0123456789abcdefghi",
} as const;

export const alice = Person.make({ handle: Handle.make("alice") });

export const bob = Person.make({ handle: Handle.make("bob") });

export interface Served {
  readonly method: string;
  readonly path: string;
  readonly authorization: Option.Option<string>;
}

export interface Seen {
  readonly upstream: Ref.Ref<readonly Served[]>;
  readonly minted: Ref.Ref<readonly string[]>;
  readonly started: Ref.Ref<readonly RequestId[]>;
}

export const commit = (
  cwd: string,
  message: string,
  files: Readonly<Record<string, string>>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    for (const [path, content] of Object.entries(files)) {
      const folder = path.split("/").slice(0, -1).join("/");

      if (folder !== "") {
        yield* fs
          .makeDirectory(`${cwd}/${folder}`, { recursive: true })
          .pipe(Effect.orDie);
      }

      yield* fs.writeFileString(`${cwd}/${path}`, content).pipe(Effect.orDie);
    }

    yield* gitOk(cwd, "add", "--all");
    yield* gitOk(cwd, "commit", "--quiet", "--message", message);

    return CommitSha.make(yield* gitOk(cwd, "rev-parse", "HEAD"));
  });

export const as = (token: string) => [
  "-c",
  `http.extraHeader=Authorization: Basic ${btoa(`x:${token}`)}`,
];

const listen = <E, R>(
  app: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest
  >,
  context: Context.Context<R>
) =>
  Effect.gen(function* () {
    const served = yield* Layer.build(
      HttpServer.serve(app.pipe(Effect.provide(context), Effect.orDie)).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest)
      )
    ).pipe(Effect.orDie);

    const { address } = Context.get(served, HttpServer.HttpServer);

    if (!("port" in address)) {
      return yield* Effect.die("the server listens on a unix socket");
    }

    return `http://127.0.0.1:${address.port}`;
  });

const upstreamApp = (root: string, seen: Seen["upstream"]) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const web = yield* HttpServerRequest.toWeb(request);
    const url = new URL(web.url);

    yield* Ref.update(seen, (all) => [
      ...all,
      {
        authorization: Option.fromNullishOr(web.headers.get("authorization")),
        method: web.method,
        path: `${url.pathname}${url.search}`,
      },
    ]);

    return HttpServerResponse.fromWeb(
      yield* Effect.scoped(httpBackend(root)(web))
    );
  });

const gatewayApp = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* HttpServerRequest.toWeb(request);

  const response = yield* Option.match(serveGit(web), {
    onNone: () =>
      Effect.succeed(new Response("not a git path\n", { status: 404 })),
    onSome: (served) => served,
  });

  return HttpServerResponse.fromWeb(response);
});

const mintingHost = (minted: Seen["minted"]) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        mintToken: (name, scope, ttl) =>
          Effect.tap(host.mintToken(name, scope, ttl), (token) =>
            Ref.update(minted, (all) => [...all, Redacted.value(token.secret)])
          ),
      });
    })
  );

const policyOf = (
  scenarios: readonly Scenario[],
  project: ProjectName
): Option.Option<Policy> =>
  Option.orElse(
    Option.fromUndefinedOr(
      scenarios.find((scenario) => scenario.project === project)?.policy
    ),
    () =>
      Option.map(Option.fromUndefinedOr(scenarios[0]?.policy), (any) => ({
        ...any,
        asks: [],
      }))
  );

const rulesOf = (scenarios: readonly Scenario[]) =>
  Layer.effect(
    RulesEvaluator,
    Effect.gen(function* () {
      const finishers = yield* Finishers;

      return RulesEvaluator.of({
        call: () => Effect.succeed(false),
        evaluate: ({ at, facts }) =>
          Option.match(policyOf(scenarios, facts.project), {
            onNone: () => Effect.die("the world has no scenario"),
            onSome: (policy) =>
              Effect.succeed({
                ...policy,
                at,
                judge: finishers.judgeClosure(policy.run, facts.ci),
              } satisfies Policy),
          }),
      });
    })
  ).pipe(Layer.provide(FinishersFromChecks));

const checkLane = LaneName.make("redThenGreen");

const failedOnce: LaneResult = {
  command: "bun test",
  durationMs: 1,
  lane: checkLane,
  result: "failed",
};

const askFiles = (ask: Ask) =>
  Array.make(
    { content: `export default "${ask.id}";\n`, path: ask.file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { parse } from "../src/parse.ts";`,
        ``,
        `it("${ask.id}", () => {`,
        `  expect(parse("2026-10-07")).toStrictEqual({ year: 2026 });`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(ask.check)
        ? ask.check.path
        : RepoPath.make(`test/${ask.id}.test.ts`),
    }
  );

const startedRuns = (started: Seen["started"]) =>
  Layer.succeed(
    AnswerRuns,
    AnswerRuns.of({
      start: (requestId) => Ref.update(started, (all) => [...all, requestId]),
    })
  );

export const gatewayWorld = (scenarios: readonly Scenario[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
    const repos = `${root}/repos`;

    const seen: Seen = {
      minted: yield* Ref.make<readonly string[]>([]),
      started: yield* Ref.make<readonly RequestId[]>([]),
      upstream: yield* Ref.make<readonly Served[]>([]),
    };

    yield* fs.makeDirectory(repos, { recursive: true }).pipe(Effect.orDie);

    const upstreamOrigin = yield* listen(
      upstreamApp(repos, seen.upstream),
      yield* Layer.build(NodeServices.layer)
    );

    const host = mintingHost(seen.minted).pipe(
      Layer.provide(
        RepoHostLocal.layer({
          remoteBase: `${upstreamOrigin}/git`,
          root: repos,
        })
      )
    );

    // The Checker reads its script when it runs, so a test may add to it.
    const script = new Map<string, readonly LaneResult[]>();

    const ports = Layer.mergeAll(
      AlarmsMemory,
      ProjectionMemory,
      CheckRunnerMemory.layer(script),
      startedRuns(seen.started),
      rulesOf(scenarios)
    ).pipe(Layer.provideMerge(LanderIsogit));

    const services = yield* Layer.build(
      Layer.mergeAll(
        ProjectsMemory,
        UpstreamRepoHost,
        MemorySessions.layer({
          [tokens.alice]: alice.handle,
          [tokens.bob]: bob.handle,
        })
      ).pipe(
        Layer.provideMerge(ports),
        Layer.provideMerge(host),
        Layer.provide(WorkerFetch)
      )
    );

    const lander = Context.get(services, Lander);

    const repoHost = Context.get(services, RepoHost);

    const origin = yield* listen(gatewayApp, services);

    const openAsk = (
      api: ProjectApi,
      main: LandedSha,
      ask: Ask,
      decider: Person = alice
    ) =>
      Effect.gen(function* () {
        const files = askFiles(ask);

        const { commit: composed } = yield* lander.compose({
          files,
          main,
          repo: RepoName.make(keyOf(ask.project)),
        });

        script.set(
          scriptKey(CheckAt.cases.Commit.make({ commit: composed }), checkLane),
          [failedOnce, failedOnce]
        );

        return yield* api.openAsk(decider, { ask: ask.id, files });
      }).pipe(Effect.orDie);

    return {
      host: repoHost,
      openAsk,
      origin,
      projects: Context.get(services, Projects),
      repos,
      root,
      seen,
      urlOf: (repo: string) =>
        `${origin}/${
          repo.includes("/")
            ? repo
            : Option.getOrElse(addressOfRepo(RepoName.make(repo)), () => repo)
        }.git`,
    };
  });
