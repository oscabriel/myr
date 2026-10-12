import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckSpec } from "@repo/protocol/domain/check";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { LandingView } from "@repo/protocol/domain/landing";
import {
  AskId,
  CommitSha,
  LandedSha,
  LaneName,
  RepoName,
  keyOf,
  RepoPath,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { RulesEvaluator, RulesFailed } from "@repo/rules/rules-evaluator";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, DateTime, Effect, Layer, Option } from "effect";

import { NoEnv } from "../src/env-port.ts";
import { ProjectStore } from "../src/project-store.ts";
import { projectService } from "../src/project.ts";
import { NoVisibility } from "../src/visibility-port.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const alice = Person.make({ handle: scenario.initializer });

const bob = Person.make({
  handle: scenario.people.get("bob") ?? scenario.initializer,
});

const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

const parseIso = Option.getOrThrow(
  Array.findFirst(scenario.policy.asks, (ask) => ask.id === "parse-iso")
);

const askFiles = Array.make(
  { content: 'export default "parse-iso";\n', path: parseIso.file },
  {
    content: [
      'import { expect, it } from "vitest";',
      'import { parser } from "../src/parser.ts";',
      "",
      'it("parse-iso", () => {',
      '  expect(parser(" 2026 ")).toStrictEqual("2026");',
      "});",
      "",
    ].join("\n"),
    path: CheckSpec.guards.RedThenGreen(parseIso.check)
      ? parseIso.check.path
      : RepoPath.make(`${Brand.configDir}/checks/parse-iso.test.ts`),
  }
);

const imported = CommitSha.make("b".repeat(40));

const read = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const before = {
    forks: yield* api.forks(),
    head: yield* api.head(),
    policy: yield* api.policy(),
  };

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  const { landed: adopted } = yield* api.recordFirstPush(alice, first);
  const composed = yield* composedAt(repo, adopted, askFiles);

  yield* CheckScript.use((checker) =>
    checker.script(composed, LaneName.make("redThenGreen"), [
      "failed",
      "failed",
    ])
  );

  const { landed } = yield* api.openAsk(alice, {
    ask: parseIso.id,
    files: askFiles,
  });

  const { claim } = yield* api.claim(bob, parseIso.id);

  const landedEvents = (yield* api.events(0, 100)).flatMap(({ event }) =>
    ProjectEvent.guards.Landed(event) ? [event.landing] : []
  );

  return {
    adopted,
    after: {
      forks: yield* api.forks(),
      head: yield* api.head(),
      landings: yield* api.landings([landed, imported]),
      policy: yield* api.policy(),
    },
    before,
    claim,
    landed,
    landedEvents,
  };
});

const world = Layer.mergeAll(worldOf(scenario, "memory"), NoVisibility, NoEnv);

describe("a project's reads for its code and its people", () => {
  it.effect(
    "hear the adoption and an ask's opening as landings, the opening naming the ask it opened, so a list of landings shows both",
    () =>
      Effect.map(read.pipe(Effect.provide(world)), (got) => {
        expect(
          got.landedEvents.map(({ ask, opened, sha }) => ({ ask, opened, sha }))
        ).toStrictEqual([
          { ask: undefined, opened: undefined, sha: got.adopted },
          { ask: undefined, opened: parseIso.id, sha: got.landed },
        ]);
      })
  );

  it.effect(
    "say where main landed, which commits are landings, the forks and the public policy",
    () =>
      Effect.map(read.pipe(Effect.provide(world)), (got) => {
        expect(got.before).toStrictEqual({ forks: [], head: {}, policy: {} });
        expect(got.after.head).toStrictEqual({ landed: got.landed });
        expect(
          got.after.landings.map(({ ask, opened, parent, sha }) => ({
            ask,
            opened,
            parent,
            sha,
          }))
        ).toStrictEqual([
          {
            ask: undefined,
            opened: parseIso.id,
            parent: got.adopted,
            sha: got.landed,
          },
        ]);
        expect(got.after.forks).toStrictEqual([
          {
            ask: parseIso.id,
            handle: bob.handle,
            kind: "claim",
            repo: got.claim.fork,
            state: "live",
          },
        ]);

        const policy = Option.getOrThrow(
          Option.fromUndefinedOr(got.after.policy.policy)
        );

        expect({
          deciders: policy.deciders,
          hidden: ["asks", "functions", "visibility"].filter(
            (key) => key in policy
          ),
          keys: Object.keys(got.after.policy),
        }).toStrictEqual({
          deciders: scenario.policy.deciders,
          hidden: [],
          keys: ["policy"],
        });
      })
  );
});

const shaOf = (digit: string) => LandedSha.make(digit.repeat(40));

/** Rows as an older build wrote them: landings with no `opened`. */
const olderRows = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const landedAt = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

  const row = (sha: LandedSha): LandingView => ({
    assisted: [],
    author: alice.handle,
    credits: [{ handle: alice.handle, role: "Asked-by" }],
    landedAt,
    project,
    sha,
  });

  const parent = AskId.make("migrate-p");

  yield* ProjectStore.use((store) =>
    store.commit({
      asks: [
        { ...parseIso, openedIn: shaOf("c") },
        {
          ...parseIso,
          id: AskId.make("migrate-p-1"),
          openedIn: shaOf("d"),
          parent,
        },
        { ...parseIso, id: parent, openedIn: shaOf("d") },
      ],
      landings: [
        row(shaOf("c")),
        row(shaOf("d")),
        { ...row(shaOf("e")), ask: parseIso.id },
      ],
    })
  );

  return {
    landing: yield* api.landing(alice, shaOf("d")),
    landings: yield* api.landings([shaOf("c"), shaOf("d"), shaOf("e")]),
  };
});

describe("an opening's landing", () => {
  it.effect(
    "names the ask it opened when read, though its row was written without it: a migrate family's parent, never a step, and never on an answer",
    () =>
      Effect.map(olderRows.pipe(Effect.provide(world)), (got) => {
        expect(
          got.landings.map(({ ask, opened, sha }) => ({ ask, opened, sha }))
        ).toStrictEqual([
          { ask: undefined, opened: parseIso.id, sha: shaOf("c") },
          { ask: undefined, opened: "migrate-p", sha: shaOf("d") },
          { ask: parseIso.id, opened: undefined, sha: shaOf("e") },
        ]);
        expect(got.landing.landing.opened).toBe("migrate-p");
      })
  );
});

const failingRules = Layer.succeed(
  RulesEvaluator,
  RulesEvaluator.of({
    call: () => Effect.succeed(false),
    evaluate: () =>
      Effect.fail(
        new RulesFailed({ detail: "no test command", reason: "threw" })
      ),
  })
);

const unevaluatedAfter = (files: Files) =>
  Effect.gen(function* () {
    yield* advanceTo("2026-10-07T12:00:00Z");

    const api = yield* projectService(project);

    yield* api.initProject(alice, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), files, "Start")
    );

    const { landed } = yield* api.recordFirstPush(alice, first);

    return { landed, policy: yield* api.policy() };
  }).pipe(Effect.provide(Layer.merge(world, failingRules)));

describe("a policy that has not evaluated", () => {
  it.effect("says the landed tree has no config folder, when it has none", () =>
    Effect.map(unevaluatedAfter(start), ({ landed, policy }) => {
      expect(policy).toStrictEqual({
        unevaluated: { at: landed, reason: "noConfig" },
      });
    })
  );

  it.effect(
    "says the config folder did not evaluate, when the landed tree has one",
    () =>
      Effect.map(
        unevaluatedAfter([
          ...start,
          [`${Brand.configDir}/project.ts`, "export default {};\n"],
        ]),
        ({ landed, policy }) => {
          expect(policy).toStrictEqual({
            unevaluated: { at: landed, reason: "configFailed" },
          });
        }
      )
  );
});
