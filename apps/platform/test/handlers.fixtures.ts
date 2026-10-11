/**
 * The world the contracts' handlers run over in tests: `ProjectsMemory`
 * over memory adapters (the isomorphic-git Lander on `RepoHostMemory`, a
 * Checker that fails every lane by an assertion, a rules evaluator that
 * returns each scenario's policy), a seeded `FrontPageMemory`, and memory
 * rate limits. `seeded` makes a scenario's project the way its initializer
 * would: made, its first commit pushed, and each of its asks opened red
 * first. Callers reach the handlers through the in-process RPC client, each
 * as the person `as` names.
 */
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

/** A library of four small packages, as each project's first commit holds it. */
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

/** An ask's own files: its file in the config folder, and its check. */
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

/**
 * A Checker before any answer: every lane fails by the same assertion each
 * time, so every ask a test opens is red first on main.
 */
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

/**
 * A `RulesEvaluator` that evaluates nothing: for a project it returns its
 * scenario's policy, holding the asks whose files the commit's config folder
 * has, and the judge closure `checks` derives.
 */
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

/** What the world is made of besides its scenarios' projects. */
export interface WorldOptions {
  /** What the front page reads back; nothing by default. */
  readonly frontPage?: FrontPageSeed;
  /** Claims and proposals each person may make; 100 of each by default. */
  readonly limits?: {
    readonly claim: number;
    readonly draft?: number;
    readonly proposal: number;
  };
}

const noFrontPage: FrontPageSeed = { credits: [], entries: [], projects: [] };

/**
 * The ports the handlers run on, `RepoHost` beside them for `seeded`, fresh
 * for each test.
 */
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
      proposal: options.limits?.proposal ?? 100,
    }),
    EvidenceStoreMemory
  ).pipe(Layer.provideMerge(RepoHostMemory));

/**
 * The scenario's project as its initializer makes it: made, its first
 * commit pushed to `main`, then each of its asks opened, red first.
 */
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

/** A client of the contracts in process, each call made as `handle`. */
export const as = (handle: string) =>
  RpcTest.makeClient(Contracts).pipe(
    Effect.provide(asPerson(Handle.make(handle)))
  );
