import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CheckAt } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { Lander } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { FinishersFromChecks } from "@repo/project/project";
import { ProjectionMemory } from "@repo/project/projection/memory";
import type { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  LandedSha,
  LaneName,
  RepoName,
  keyOf,
  RepoPath,
} from "@repo/protocol/ids";
import type { CommitSha, ProjectName } from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import {
  Array,
  Cause,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Predicate,
} from "effect";

import { DoAlarms } from "../src/adapters/alarms.ts";
import type { AlarmStorage } from "../src/adapters/alarms.ts";
import { AnswerRunsWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import type { AnswerWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import type { AnswerParams } from "../src/answer-runs.ts";
import { decodeReply, encodeCall } from "../src/project-calls.ts";
import type {
  ArgsOf,
  ErrorOf,
  ProjectMethod,
  SuccessOf,
} from "../src/project-calls.ts";
import { projectShell } from "../src/project-shell.ts";
import type { ProjectShell } from "../src/project-shell.ts";
import { inProcessNamespace } from "./project-namespace.ts";

const mainRef = RefName.make("refs/heads/main");

export const scenario = aProject({ people: ["bob", "carol"] }).pipe(
  withVouches(["bob", "carol"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

export const { project } = scenario;

export const repo = RepoName.make(keyOf(project));

export const parseIso = AskId.make("parse-iso");

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

export const alice = person("alice");

export const bob = person("bob");

export const carol = person("carol");

export const anyone = Anonymous.make({});

export const redThenGreen = LaneName.make("redThenGreen");

const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

export const askFiles = () => {
  const ask = Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, ({ id }) => id === parseIso)
  );

  return Array.make(
    { content: `export default "${parseIso}";\n`, path: ask.file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { parse } from "../src/parse.ts";`,
        ``,
        `it("${parseIso}", () => {`,
        `  expect(parse("2026-10-07")).toStrictEqual({ year: 2026 });`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(ask.check)
        ? ask.check.path
        : RepoPath.make(`test/${parseIso}.test.ts`),
    }
  );
};

export const fixedFiles: Files = [
  ...start.filter(([path]) => path !== "packages/parser/src/parse.ts"),
  ...askFiles().map(({ content, path }) => [path, content] as const),
  [
    "packages/parser/src/parse.ts",
    "export const parse = (s) => ({ year: 2026 });\n",
  ],
];

export const forkOf = (who: Person) =>
  RepoName.make(`${keyOf(project)}--${parseIso}--${who.handle}`);

export class CheckScript extends Context.Service<
  CheckScript,
  {
    readonly script: (
      at: CheckAt,
      lane: LaneName,
      results: readonly LaneOutcome[]
    ) => Effect.Effect<void>;
  }
>()("test/CheckScript") {}

export class Pusher extends Context.Service<
  Pusher,
  {
    readonly push: (
      repo: RepoName,
      parent: Option.Option<CommitSha>,
      files: Files,
      message?: string
    ) => Effect.Effect<CommitSha>;
  }
>()("test/Pusher") {}

export class SetAlarms extends Context.Service<
  SetAlarms,
  { readonly all: Effect.Effect<readonly number[]> }
>()("test/SetAlarms") {}

export type InstanceState = Awaited<
  ReturnType<Awaited<ReturnType<AnswerWorkflow["get"]>>["status"]>
>["status"];

export class Instances extends Context.Service<
  Instances,
  {
    readonly end: (id: string, state: InstanceState) => Effect.Effect<void>;
    readonly made: Effect.Effect<
      readonly {
        readonly id: string;
        readonly params: typeof AnswerParams.Encoded;
      }[]
    >;
    readonly restarts: Effect.Effect<readonly string[]>;
    readonly tries: Effect.Effect<number>;
  }
>()("test/Instances") {}

const rules = Layer.effect(
  RulesEvaluator,
  Effect.gen(function* () {
    const finishers = yield* Finishers;
    const { policy } = scenario;

    return RulesEvaluator.of({
      call: () => Effect.succeed(false),
      evaluate: ({ at, facts, modules }) =>
        Effect.succeed({
          ...policy,
          asks: policy.asks.filter(({ file }) => file in modules.modules),
          at,
          judge: finishers.judgeClosure(policy.run, facts.ci),
        } satisfies Policy),
    });
  })
);

const checker = Layer.effectContext(
  Effect.gen(function* () {
    // The Checker reads its script when it runs, so the test may add to it later.
    const script = new Map<string, readonly LaneResult[]>();
    const runner = yield* Layer.build(CheckRunnerMemory.layer(script));

    return runner.pipe(
      Context.add(CheckScript, {
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
      })
    );
  })
);

const pusher = Layer.effect(
  Pusher,
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const client = yield* gitClient(memoryFs());

    return Pusher.of({
      push: (target, parent, files, message = "Work") =>
        Effect.gen(function* () {
          const sha = yield* client.commit(
            message,
            files,
            Option.toArray(parent)
          );

          yield* host
            .push(target, client.source, [
              { from: parent, ref: mainRef, to: sha },
            ])
            .pipe(Effect.orDie);

          return sha;
        }),
    });
  })
);

const alarms = Layer.unwrap(
  Effect.sync(() => {
    const set: number[] = [];

    const storage: AlarmStorage = {
      setAlarm: (at) => {
        set.push(Predicate.isDate(at) ? at.getTime() : at);

        return Promise.resolve();
      },
    };

    return Layer.merge(
      DoAlarms(storage),
      Layer.succeed(SetAlarms, { all: Effect.sync(() => [...set]) })
    );
  })
);

export const answerWorkflow = () => {
  const made = new Map<string, typeof AnswerParams.Encoded>();
  const states = new Map<string, InstanceState>();
  const tries: string[] = [];
  const restarts: string[] = [];

  const instance = (id: string) => ({
    id,
    restart: () => {
      restarts.push(id);
      states.set(id, "running");

      return Promise.resolve();
    },
    status: () => Promise.resolve({ status: states.get(id) ?? "running" }),
  });

  const workflow: AnswerWorkflow = {
    create: ({ id, params }) => {
      tries.push(id);

      if (made.has(id)) {
        return Promise.reject(new Error(`instance ${id} already exists`));
      }

      made.set(id, params);
      states.set(id, "running");

      return Promise.resolve({ id });
    },
    get: (id) =>
      made.has(id)
        ? Promise.resolve(instance(id))
        : Promise.reject(new Error(`no instance ${id}`)),
  };

  const instances = Instances.of({
    end: (id, state) =>
      Effect.sync(() => {
        states.set(id, state);
      }),
    made: Effect.sync(() => [...made].map(([id, params]) => ({ id, params }))),
    restarts: Effect.sync(() => [...restarts]),
    tries: Effect.sync(() => tries.length),
  });

  return { instances, workflow };
};

const answers = Layer.unwrap(
  Effect.sync(() => {
    const { instances, workflow } = answerWorkflow();

    return Layer.merge(
      AnswerRunsWorkflow(workflow, project),
      Layer.succeed(Instances, instances)
    );
  })
);

export const world = Layer.mergeAll(
  alarms,
  answers,
  checker,
  EvidenceStoreMemory,
  ProjectionMemory,
  pusher,
  rules
).pipe(
  Layer.provideMerge(FinishersFromChecks),
  Layer.provideMerge(LanderIsogit),
  Layer.provideMerge(RepoHostMemory)
);

export type World = Layer.Success<typeof world>;

export const databaseFile = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "project-do-" })),
  Effect.map((folder) => `${folder}/project.sqlite`),
  Effect.orDie,
  Effect.provide(NodeServices.layer)
);

export const shellOver = (
  filename: string,
  name: Option.Option<ProjectName> = Option.some(project)
) =>
  Effect.gen(function* () {
    const ports = yield* Effect.context<World>();

    return yield* projectShell({
      name: Option.getOrUndefined(name),
      ports: Layer.succeedContext(ports),
      sql: SqliteClient.layer({ filename }).pipe(Layer.orDie),
    });
  });

export type Call = <M extends ProjectMethod>(
  method: M,
  args: ArgsOf<M>
) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>;

export const through =
  (shell: ProjectShell): Call =>
  (method, args) =>
    encodeCall(method, args).pipe(
      Effect.flatMap((request) => shell.call(request)),
      Effect.flatMap((reply) => decodeReply(method, reply))
    );

export const opening = (call: Call) =>
  Effect.gen(function* () {
    yield* call("initProject", [alice, {}]);

    const first = yield* Pusher.use((git) =>
      git.push(repo, Option.none(), start, "Start")
    );

    const { landed } = yield* call("recordFirstPush", [alice, first]);
    const files = askFiles();

    const { commit } = yield* Lander.use((lander) =>
      lander.compose({ files, main: landed, repo })
    ).pipe(Effect.orDie);

    yield* CheckScript.use((scripted) =>
      scripted.script(CheckAt.cases.Commit.make({ commit }), redThenGreen, [
        "failed",
        "failed",
      ])
    );

    return yield* call("openAsk", [alice, { ask: parseIso, files }]);
  });

export const tipOf = (name: RepoName) =>
  Effect.gen(function* () {
    const refs = yield* (yield* RepoHost).refs(name).pipe(Effect.orDie);

    return LandedSha.make(
      Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
    );
  });

export const outcomeOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(
    Effect.exit(effect),
    Exit.match({
      onFailure: (cause) =>
        Option.match(Cause.findErrorOption(cause), {
          onNone: () => "died" as const,
          onSome: (refused) => ({ refused }),
        }),
      onSuccess: (value) => ({ value }),
    })
  );

/** A front page that lists nothing, so every project is probed as it was before listings seeded the adapter. */
export const unlisted = FrontPageMemory.layer({
  credits: [],
  entries: [],
  projects: [],
});

export const namespaceOf = inProcessNamespace((name) =>
  shellOver(":memory:", Option.some(name))
);
