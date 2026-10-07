/**
 * One project's world for the Project DO's tests: the ports a Project DO
 * runs on, over memory adapters, with the DO's own `Alarms` and
 * `AnswerRuns` adapters over fakes of its storage and the `Answer`
 * Workflow binding, and shells over sqlite-node. The tests drive projects
 * only through the encoded boundary (`encodeCall` → shell → `decodeReply`).
 *
 * The world is the shape of `packages/project/test/world.ts`: the scripted
 * Checker, the rules evaluator that returns the scenario's policy, and
 * pushes made as an answerer's git would make them.
 */
import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CheckAt } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
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
  ProjectName,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { untouchable } from "@repo/testkit/untouchable";
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
  SynchronizedRef,
} from "effect";
import type { Scope } from "effect";

import { DoAlarms } from "../src/adapters/alarms.ts";
import type { AlarmStorage } from "../src/adapters/alarms.ts";
import { AnswerRunsWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import type { AnswerWorkflow } from "../src/adapters/answer-runs-workflow.ts";
import type { ProjectNamespace } from "../src/adapters/do-projects.ts";
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

const mainRef = RefName.make("refs/heads/main");

export const scenario = aProject({ people: ["bob", "carol"] }).pipe(
  withVouches(["bob", "carol"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

export const { project } = scenario;

export const repo = RepoName.make(project);

export const parseIso = AskId.make("parse-iso");

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

export const alice = person("alice");

export const bob = person("bob");

export const carol = person("carol");

export const anyone = Anonymous.make({});

export const redThenGreen = LaneName.make("redThenGreen");

/** The project as alice first pushes it. */
const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

/** `parse-iso`'s own files: its file in the config folder, and its check. */
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

/** Main once `parse-iso` opened, with its parser fixed: an answer in its territory. */
export const fixedFiles: Files = [
  ...start.filter(([path]) => path !== "packages/parser/src/parse.ts"),
  ...askFiles().map(({ content, path }) => [path, content] as const),
  [
    "packages/parser/src/parse.ts",
    "export const parse = (s) => ({ year: 2026 });\n",
  ],
];

/** The fork a claim of `parse-iso` pushes to. */
export const forkOf = (who: Person) =>
  RepoName.make(`${project}--${parseIso}--${who.handle}`);

/** What the Checker answers, by `(tree or commit, lane)`; the test adds to it. */
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

/** Commits made the way an answerer's git would make them, pushed to a repo's `main`. */
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

/** Every alarm the DO's storage was asked to set, in epoch milliseconds, in order. */
export class SetAlarms extends Context.Service<
  SetAlarms,
  { readonly all: Effect.Effect<readonly number[]> }
>()("test/SetAlarms") {}

/** Every `Answer` Workflow instance made, in order, and how many creates were tried. */
export class Instances extends Context.Service<
  Instances,
  {
    readonly made: Effect.Effect<
      readonly {
        readonly id: string;
        readonly params: typeof AnswerParams.Encoded;
      }[]
    >;
    readonly tries: Effect.Effect<number>;
  }
>()("test/Instances") {}

/** At any commit, the scenario's policy, holding the asks whose files the commit has. */
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

/** The DO's storage, as far as its alarm goes: it keeps every time it is set to. */
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

/**
 * The `Answer` Workflow binding: an instance per id, made once. Like the
 * real one, `create` refuses an id it has, and `get` finds it.
 */
export const answerWorkflow = () => {
  const made = new Map<string, typeof AnswerParams.Encoded>();
  const tries: string[] = [];

  const workflow: AnswerWorkflow = {
    create: ({ id, params }) => {
      tries.push(id);

      if (made.has(id)) {
        return Promise.reject(new Error(`instance ${id} already exists`));
      }

      made.set(id, params);

      return Promise.resolve({ id });
    },
    get: (id) =>
      made.has(id)
        ? Promise.resolve({ id })
        : Promise.reject(new Error(`no instance ${id}`)),
  };

  const instances = Instances.of({
    made: Effect.sync(() => [...made].map(([id, params]) => ({ id, params }))),
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

/**
 * Every port a Project DO's shell takes, over memory adapters and the DO's
 * own `Alarms` and `AnswerRuns` adapters, and what the tests read back.
 * Fresh each time it is built.
 */
export const world = Layer.mergeAll(
  alarms,
  answers,
  checker,
  ProjectionMemory,
  pusher,
  rules
).pipe(
  Layer.provideMerge(FinishersFromChecks),
  Layer.provideMerge(LanderIsogit),
  Layer.provideMerge(RepoHostMemory)
);

export type World = Layer.Success<typeof world>;

/** A new SQLite file, removed with its folder when the test ends. */
export const databaseFile = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "project-do-" })),
  Effect.map((folder) => `${folder}/project.sqlite`),
  Effect.orDie,
  Effect.provide(NodeServices.layer)
);

/** A Project DO's shell for `name` over the SQLite at `filename`, on the world's ports. */
export const shellOver = (
  filename: string,
  name: ProjectName | undefined = project
) =>
  Effect.gen(function* () {
    const ports = yield* Effect.context<World>();

    return yield* projectShell({
      name,
      ports: Layer.succeedContext(ports),
      sql: SqliteClient.layer({ filename }).pipe(Layer.orDie),
    });
  });

/** One method called on a project, as its own types. */
export type Call = <M extends ProjectMethod>(
  method: M,
  args: ArgsOf<M>
) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>;

/** Calls on a project through its DO's boundary: encoded, answered by `shell`, decoded. */
export const through =
  (shell: ProjectShell): Call =>
  (method, args) =>
    encodeCall(method, args).pipe(
      Effect.flatMap((request) => shell.call(request)),
      Effect.flatMap((reply) => decodeReply(method, reply))
    );

/**
 * The project made by alice, her first push recorded, and `parse-iso`
 * opened: its check fails twice the same way on main with its files.
 */
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

/** Where `main` of `repo` stands now. */
export const tipOf = (name: RepoName) =>
  Effect.gen(function* () {
    const refs = yield* (yield* RepoHost).refs(name).pipe(Effect.orDie);

    return LandedSha.make(
      Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
    );
  });

/** What a call came to: its value, its typed refusal, or `died`. */
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

/**
 * The `PROJECT` namespace in process: a name is one DO, and its stub runs a
 * shell of its own, over a SQLite of its own, on the world's ports and the
 * test's clock. `names` lists the DOs made, in order.
 */
export const namespaceOf = Effect.gen(function* () {
  const context = yield* Effect.context<World | Scope.Scope>();

  const shells = yield* SynchronizedRef.make<ReadonlyMap<string, ProjectShell>>(
    new Map()
  );

  const shellFor = (name: string) =>
    SynchronizedRef.modifyEffect(shells, (all) =>
      Option.match(Option.fromUndefinedOr(all.get(name)), {
        onNone: () =>
          Effect.map(
            shellOver(":memory:", ProjectName.make(name)),
            (shell) => [shell, new Map(all).set(name, shell)] as const
          ),
        onSome: (shell) => Effect.succeed([shell, all] as const),
      })
    );

  const namespace: ProjectNamespace = {
    get: (id) => ({
      call: (request) =>
        Effect.runPromiseWith(context)(
          Effect.flatMap(shellFor(id.toString()), (shell) =>
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

  return {
    names: Effect.map(SynchronizedRef.get(shells), (all) => [...all.keys()]),
    namespace,
  };
});
