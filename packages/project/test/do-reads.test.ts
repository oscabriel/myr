/**
 * The four small reads the code browser and the people page take from a
 * project's record: where main has landed, which commits are landings,
 * which forks exist, and the policy as anyone may read it.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckSpec } from "@repo/protocol/domain/check";
import { CommitSha, LaneName, RepoName, RepoPath } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Effect, Layer, Option } from "effect";

import { NoEnv } from "../src/env-port.ts";
import { projectService } from "../src/project.ts";
import { NoVisibility } from "../src/visibility-port.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(project);

const alice = Person.make({ handle: scenario.initializer });

const bob = Person.make({
  handle: scenario.people.get("bob") ?? scenario.initializer,
});

const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
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

/** A commit that is no landing: imported history, say. */
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
  };
});

const world = Layer.mergeAll(worldOf(scenario, "memory"), NoVisibility, NoEnv);

describe("a project's reads for its code and its people", () => {
  it.effect(
    "say where main landed, which commits are landings, the forks and the public policy",
    () =>
      Effect.map(read.pipe(Effect.provide(world)), (got) => {
        expect(got.before).toStrictEqual({
          forks: [],
          head: {},
          policy: Option.none(),
        });
        expect(got.after.head).toStrictEqual({ landed: got.landed });
        // The ask's opening landed on the adoption; the other commit is none.
        expect(
          got.after.landings.map(({ parent, sha }) => ({ parent, sha }))
        ).toStrictEqual([{ parent: got.adopted, sha: got.landed }]);
        expect(got.after.forks).toStrictEqual([
          {
            ask: parseIso.id,
            handle: bob.handle,
            kind: "claim",
            repo: got.claim.fork,
            state: "live",
          },
        ]);

        const policy = Option.getOrThrow(got.after.policy);

        expect({
          deciders: policy.deciders,
          hidden: ["asks", "functions", "visibility"].filter(
            (key) => key in policy
          ),
        }).toStrictEqual({ deciders: scenario.policy.deciders, hidden: [] });
      })
  );
});
