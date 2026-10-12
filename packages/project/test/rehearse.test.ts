import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { CheckAt } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import type { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import { CheckSpec } from "@repo/protocol/domain/check";
import {
  AskId,
  LandedSha,
  LaneName,
  RepoName,
  keyOf,
  RepoPath,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { NotRedFirst } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Effect, Layer, Option } from "effect";

import { Rehearsal } from "../src/draft-runs.ts";
import { Lander } from "../src/lander.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { Pusher, worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-week", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(keyOf(project));

const alice = Person.make({
  handle: scenario.people.get("alice") ?? scenario.initializer,
});

const redThenGreen = LaneName.make("redThenGreen");

const ask = Option.getOrThrow(
  Array.findFirst(scenario.policy.asks, ({ id }) => id === "parse-week")
);

const start: Files = [
  [
    "package.json",
    '{ "name": "alice/datekit", "workspaces": ["packages/*"] }\n',
  ],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

const files = Array.make(
  { content: `export default "parse-week";\n`, path: ask.file },
  {
    content: [
      `import { expect, it } from "bun:test";`,
      `import { parseWeek } from "../src/parse.ts";`,
      ``,
      `it("parses a week", () => {`,
      `  expect(parseWeek("2026-W41")).toStrictEqual({ week: 41 });`,
      `});`,
      ``,
    ].join("\n"),
    path: CheckSpec.guards.RedThenGreen(ask.check)
      ? ask.check.path
      : RepoPath.make("packages/parser/test/week.test.ts"),
  }
);

const mainRef = RefName.make("refs/heads/main");

const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return Option.fromUndefinedOr(refs.get(mainRef));
});

const rehearsed = (results: readonly LaneOutcome[], stdout = "") => {
  const script = new Map<string, readonly LaneResult[]>();
  const outputs = new Map<string, string>();

  return Effect.gen(function* () {
    yield* advanceTo("2026-10-08T12:00:00Z");

    const api: ProjectApi = yield* projectService(project);

    yield* api.initProject(alice, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    yield* api.recordFirstPush(alice, first);

    const { commit, tree } = yield* Lander.use((lander) =>
      lander.compose({ files, main: LandedSha.make(first), repo })
    ).pipe(Effect.orDie);

    const key = scriptKey(CheckAt.cases.Commit.make({ commit }), redThenGreen);

    script.set(
      key,
      results.map((result) => ({
        command: "bun test",
        durationMs: 1,
        lane: redThenGreen,
        result,
      }))
    );
    outputs.set(key, stdout);

    const before = yield* ProjectStore.use((store) => store.load());
    const rehearsal = yield* api.rehearseOpen(files);
    const after = yield* ProjectStore.use((store) => store.load());

    return {
      after: {
        asks: after.asks,
        decisions: after.decisions,
        landings: after.landings,
        main: yield* mainTip,
      },
      api,
      before: {
        asks: before.asks,
        decisions: before.decisions,
        landings: before.landings,
        main: Option.some(first),
      },
      rehearsal,
      tree,
    };
  }).pipe(
    Effect.provide(
      Layer.merge(
        worldOf(scenario, "memory"),
        CheckRunnerMemory.layer(script, outputs)
      )
    )
  );
};

const openedAfterRehearsal = Effect.suspend(() => {
  const script = new Map<string, readonly LaneResult[]>();

  return Effect.gen(function* () {
    yield* advanceTo("2026-10-08T12:00:00Z");

    const api = yield* projectService(project);

    yield* api.initProject(alice, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    yield* api.recordFirstPush(alice, first);

    const { commit } = yield* Lander.use((lander) =>
      lander.compose({ files, main: LandedSha.make(first), repo })
    ).pipe(Effect.orDie);

    script.set(scriptKey(CheckAt.cases.Commit.make({ commit }), redThenGreen), [
      {
        command: "bun test",
        durationMs: 1,
        lane: redThenGreen,
        result: "failed",
      },
    ]);

    const rehearsal = yield* api.rehearseOpen(files);

    const opened = yield* api.openAsk(alice, {
      ask: AskId.make("parse-week"),
      files,
    });

    return {
      ask: opened.ask.id,
      listed: (yield* api.listAsks(Anonymous.make({}))).asks.map(
        (listing) => listing.ask
      ),
      rehearsed: rehearsal._tag,
    };
  }).pipe(
    Effect.provide(
      Layer.merge(worldOf(scenario, "memory"), CheckRunnerMemory.layer(script))
    )
  );
});

describe("rehearsing an ask's opening", () => {
  it.effect(
    "is Red with its lane and signature when its test fails by an assertion, and lands nothing",
    () =>
      Effect.map(rehearsed(["failed", "failed"]), (run) => {
        expect(run.rehearsal).toStrictEqual(
          Rehearsal.cases.Red.make({
            lane: redThenGreen,
            signature: "redThenGreen: scripted failure",
            tree: run.tree,
          })
        );
        expect(run.after).toStrictEqual(run.before);
      })
  );

  it.effect("is Refused as Passed when its test passes", () =>
    Effect.map(rehearsed(["passed", "passed"], "1 pass\n"), (run) => {
      expect(run.rehearsal).toStrictEqual(
        Rehearsal.cases.Refused.make({
          diagnosis: "Passed",
          excerpt: "1 pass\n",
          refusal: new NotRedFirst({}),
        })
      );
      expect(run.after).toStrictEqual(run.before);
    })
  );

  it.effect(
    "is Refused as a LoadError, with the output's tail, when its test imports an export that is missing",
    () =>
      Effect.map(
        rehearsed(
          ["loadError", "loadError"],
          "SyntaxError: Export named 'parseWeek' not found in module 'packages/parser/src/parse.ts'.\n"
        ),
        (run) => {
          expect(run.rehearsal).toStrictEqual(
            Rehearsal.cases.Refused.make({
              diagnosis: "LoadError",
              excerpt:
                "SyntaxError: Export named 'parseWeek' not found in module 'packages/parser/src/parse.ts'.\n",
              refusal: new NotRedFirst({}),
            })
          );
        }
      )
  );

  it.effect(
    "keeps only the last 4 KiB of a long output, cut between characters",
    () =>
      Effect.map(
        rehearsed(["failed", "passed"], `${"é".repeat(3000)}FAIL\n`),
        (run) => {
          const excerpt = Rehearsal.guards.Refused(run.rehearsal)
            ? run.rehearsal.excerpt
            : "";

          expect({
            bytes: new TextEncoder().encode(excerpt).length <= 4096,
            diagnosis:
              Rehearsal.guards.Refused(run.rehearsal) &&
              run.rehearsal.diagnosis,
            ends: excerpt.endsWith("ééFAIL\n"),
            starts: excerpt.startsWith("é"),
          }).toStrictEqual({
            bytes: true,
            diagnosis: "Flaky",
            ends: true,
            starts: true,
          });
        }
      )
  );

  it.effect("leaves openAsk opening the same files as it did", () =>
    Effect.map(openedAfterRehearsal, (opened) => {
      expect(opened.rehearsed).toBe("Red");
      expect(opened.ask).toStrictEqual(AskId.make("parse-week"));
      expect(opened.listed).toStrictEqual([AskId.make("parse-week")]);
    })
  );
});
