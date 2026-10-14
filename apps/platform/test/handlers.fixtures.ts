import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { CheckRunner } from "@repo/checks/check-runner";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRunsInline } from "@repo/project/answer-runs/inline";
import type { FrontPageSeed } from "@repo/project/front-page/memory";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { FinishersFromChecks } from "@repo/project/project";
import { ProjectionMemory } from "@repo/project/projection/memory";
import { Projects } from "@repo/project/projects";
import { ProjectsMemory } from "@repo/project/projects/memory";
import { Contracts } from "@repo/protocol/contracts";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { Policy } from "@repo/protocol/domain/policy";
import { Handle, keyOf, RepoName, RepoPath } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { asPerson } from "@repo/protocol/testing";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import type { Scenario } from "@repo/testkit/scenarios";
import { Array, Effect, Layer, Option } from "effect";
import { RpcTest } from "effect/rpc";

import { MemoryRateLimits } from "../src/adapters/rate-limits.ts";

const mainRef = RefName.make("refs/heads/main");

const start = (name: string): Files => [
  [
    "package.json",
    `{ "name": "${name.slice(name.lastIndexOf("/") + 1)}", "workspaces": ["packages/*"] }\n`,
  ],
  [
    "packages/format/src/format.ts",
    "export const format = (d) => String(d);\n",
  ],
  ["packages/lexer/src/lex.ts", "export const lex = (s) => s.split(' ');\n"],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  ["packages/trim/src/trim.ts", "export const trim = (s) => s;\n"],
];

const askFiles = ({ check, file, id, territory }: Ask) =>
  Array.make(
    { content: `export default "${id}";\n`, path: file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { ${territory.module} } from "../src/${territory.module}.ts";`,
        ``,
        `it("${id}", () => {`,
        `  expect(${territory.module}("2026-10-07")).toStrictEqual({ year: 2026 });`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(check)
        ? check.path
        : RepoPath.make(`test/${id}.test.ts`),
    }
  );

const allRed = Layer.succeed(
  CheckRunner,
  CheckRunner.of({
    run: ({ lanes }) =>
      Effect.succeed({
        durationMs: lanes.length,
        evidence: lanes.map(({ lane }) => ({
          lane,
          signature: `${lane}: red`,
        })),
        heldBack: [],
        lanes: lanes.map(({ command, lane }) => ({
          command,
          durationMs: 1,
          lane,
          result: "failed" as const,
        })),
      }),
  })
);

const rulesOf = (scenarios: readonly Scenario[]) =>
  Layer.effect(
    RulesEvaluator,
    Effect.gen(function* () {
      const finishers = yield* Finishers;

      return RulesEvaluator.of({
        call: () => Effect.succeed(false),
        evaluate: ({ at, facts, modules }) =>
          Effect.sync(() => {
            const { policy } = Option.getOrThrow(
              Array.findFirst(
                scenarios,
                ({ project }) => project === facts.project
              )
            );

            return {
              ...policy,
              asks: policy.asks.filter(({ file }) => file in modules.modules),
              at,
              judge: finishers.judgeClosure(policy.run, facts.ci),
            } satisfies Policy;
          }),
      });
    })
  ).pipe(Layer.provide(FinishersFromChecks));

export interface WorldOptions {
  readonly frontPage?: FrontPageSeed;
  readonly limits?: {
    readonly claim: number;
    readonly draft?: number;
    readonly post?: number;
    readonly proposal: number;
  };
}

const noFrontPage: FrontPageSeed = { credits: [], entries: [], projects: [] };

export const worldOf = (
  scenarios: readonly Scenario[],
  options: WorldOptions = {}
) =>
  Layer.mergeAll(
    ProjectsMemory.pipe(
      Layer.provide(
        Layer.mergeAll(
          AlarmsMemory,
          AnswerRunsInline,
          ProjectionMemory,
          rulesOf(scenarios)
        ).pipe(Layer.provideMerge(LanderIsogit), Layer.provideMerge(allRed))
      )
    ),
    FrontPageMemory.layer(options.frontPage ?? noFrontPage),
    MemoryRateLimits({
      claim: options.limits?.claim ?? 100,
      draft: options.limits?.draft ?? 100,
      post: options.limits?.post ?? 100,
      proposal: options.limits?.proposal ?? 100,
    }),
    EvidenceStoreMemory
  ).pipe(Layer.provideMerge(RepoHostMemory));

export const seeded = (scenario: Scenario) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const api = yield* (yield* Projects).create(scenario.project);
    const initializer = Person.make({ handle: scenario.initializer });
    const repo = RepoName.make(keyOf(scenario.project));
    const client = yield* gitClient(memoryFs());

    yield* api.initProject(initializer, {});

    const first = yield* client.commit("Start", start(scenario.project), []);

    yield* host.push(repo, client.source, [
      { from: Option.none(), ref: mainRef, to: first },
    ]);

    yield* api.recordFirstPush(initializer, first);

    yield* Effect.forEach(
      scenario.policy.asks,
      (ask) => api.openAsk(initializer, { ask: ask.id, files: askFiles(ask) }),
      { discard: true }
    );
  }).pipe(Effect.orDie);

export const as = (handle: string) =>
  RpcTest.makeClient(Contracts).pipe(
    Effect.provide(asPerson(Handle.make(handle)))
  );
