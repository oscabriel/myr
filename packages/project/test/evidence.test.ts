/**
 * Who may read a failing lane's log (`ProjectApi.evidence`): the claimant of
 * the answer the log's name points at, and the project's deciders. Anyone
 * else hears `NotDecider` whatever the name, and a name that points at
 * another project is `UnknownProject`, so no reply tells which logs exist.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { EvidenceStore, LogRef, logRefOf } from "@repo/checks/evidence-store";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { CheckSpec } from "@repo/protocol/domain/check";
import {
  AskId,
  LandedSha,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { NotDecider, UnknownProject } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Effect, Layer, Option } from "effect";

import { projectService } from "../src/project.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob", "carol"] }).pipe(
  withVouches(["bob", "carol"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(project);

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

/** The project's decider. */
const alice = person("alice");

/** The claimant whose answer failed its `unit` lane. */
const bob = person("bob");

/** Neither: vouched for, but no claimant of that answer and no decider. */
const carol = person("carol");

const parseIso = AskId.make("parse-iso");

const unit = LaneName.make("unit");

const requestId = RequestId.make("req-fix-0001");

const mainRef = RefName.make("refs/heads/main");

const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

/** The ask's own files: its file in the config folder, and its check. */
const askFiles = () => {
  const ask = Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, ({ id }) => id === parseIso)
  );

  return Array.make(
    { content: `export default "${parseIso}";\n`, path: ask.file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { parser } from "../src/parser.ts";`,
        ``,
        `it("${parseIso}", () => {`,
        `  expect(parser("2026-10-07")).toStrictEqual({ year: 2026 });`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(ask.check)
        ? ask.check.path
        : RepoPath.make("test/parse-iso.test.ts"),
    }
  );
};

/** The log bob's `unit` lane left on his answer's first merge. */
const failing = [
  "FAIL packages/parser/test/parse.test.ts > parses ISO weeks",
  "AssertionError: expected 52 to be 53",
].join("\n");

/** The name the log is kept under. */
const bobsLog = logRefOf({ attempt: 1, lane: unit, project, requestId });

const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

/**
 * alice makes the project and opens parse-iso; bob claims it and answers
 * under `requestId`; the answer's `unit` lane left `text` under its name.
 */
const answered = (text: string = failing) =>
  Effect.gen(function* () {
    yield* advanceTo("2026-10-07T12:00:00Z");

    const api = yield* projectService(project);

    yield* api.initProject(alice, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    yield* api.recordFirstPush(alice, first);

    const files = askFiles();
    const composed = yield* composedAt(repo, yield* mainTip, files);

    yield* CheckScript.use((checker) =>
      checker.script(composed, LaneName.make("redThenGreen"), [
        "failed",
        "failed",
      ])
    );

    const { landed } = yield* api.openAsk(alice, { ask: parseIso, files });
    const { claim } = yield* api.claim(bob, parseIso);

    const head = yield* Pusher.use((pusher) =>
      pusher.push(claim.fork, Option.some(landed), [
        ...start.filter(([path]) => !path.startsWith("packages/parser/")),
        ["packages/parser/src/parse.ts", "export const parse = () => 2026;\n"],
        ...files.map(({ content, path }) => [path, content] as const),
      ])
    );

    yield* api.submitAnswer(bob, {
      ask: parseIso,
      base: landed,
      head,
      requestId,
    });

    yield* (yield* EvidenceStore).put({
      attempt: 1,
      lane: unit,
      project,
      requestId,
      text,
    });

    return api;
  });

const world = Layer.merge(worldOf(scenario, "memory"), EvidenceStoreMemory);

describe("reading a failing lane's log", () => {
  it.effect(
    "gives the answer's claimant and the project's deciders the log, whole",
    () =>
      Effect.gen(function* () {
        const api = yield* answered();

        expect({
          alice: yield* api.evidence(alice, bobsLog),
          bob: yield* api.evidence(bob, bobsLog),
        }).toStrictEqual({
          alice: { lane: unit, text: failing, truncated: false },
          bob: { lane: unit, text: failing, truncated: false },
        });
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "refuses everyone else NotDecider, whether or not a log is kept under the name",
    () =>
      Effect.gen(function* () {
        const api = yield* answered();

        const never = logRefOf({
          attempt: 7,
          lane: unit,
          project,
          requestId: RequestId.make("req-none-0001"),
        });

        expect(
          yield* Effect.forEach(
            [
              api.evidence(carol, bobsLog),
              api.evidence(carol, never),
              api.evidence(Anonymous.make({}), bobsLog),
              // bob is the claimant of his own answer only.
              api.evidence(bob, never),
            ],
            Effect.flip
          )
        ).toStrictEqual([
          new NotDecider({}),
          new NotDecider({}),
          new NotDecider({}),
          new NotDecider({}),
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "refuses a name that points at another project as that project unknown, for anyone",
    () =>
      Effect.gen(function* () {
        const api = yield* answered();
        const other = ProjectName.make("burrow");

        const elsewhere = logRefOf({
          attempt: 1,
          lane: unit,
          project: other,
          requestId,
        });

        expect(
          yield* Effect.forEach(
            [
              api.evidence(alice, elsewhere),
              api.evidence(bob, elsewhere),
              api.evidence(carol, elsewhere),
            ],
            Effect.flip
          )
        ).toStrictEqual([
          new UnknownProject({ project: other }),
          new UnknownProject({ project: other }),
          new UnknownProject({ project: other }),
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "refuses a name that is no log's, or names no kept log, as nothing in the project",
    () =>
      Effect.gen(function* () {
        const api = yield* answered();

        const passed = logRefOf({
          attempt: 1,
          lane: LaneName.make("lint"),
          project,
          requestId,
        });

        // bob's own log's name, spelled as `logRefOf` never spells one.
        const respelled = LogRef.make(bobsLog.replace(/#1$/u, "#01"));

        expect(
          yield* Effect.forEach(
            [
              api.evidence(alice, LogRef.make("not a log's name")),
              api.evidence(carol, LogRef.make("not a log's name")),
              api.evidence(alice, respelled),
              api.evidence(carol, respelled),
              api.evidence(alice, passed),
            ],
            Effect.flip
          )
        ).toStrictEqual([
          new UnknownProject({ project }),
          new UnknownProject({ project }),
          new UnknownProject({ project }),
          new UnknownProject({ project }),
          new UnknownProject({ project }),
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "gives a log over 256 KiB as its last 256 KiB, where the failure prints",
    () =>
      Effect.gen(function* () {
        const tail = "AssertionError: expected 52 to be 53\n";
        const long = `${"x".repeat(300 * 1024)}${tail}`;
        const api = yield* answered(long);
        const read = yield* api.evidence(bob, bobsLog);

        expect({
          bytes: new TextEncoder().encode(read.text).length,
          endsWithFailure: read.text.endsWith(tail),
          isTail: long.endsWith(read.text),
          truncated: read.truncated,
        }).toStrictEqual({
          bytes: 256 * 1024,
          endsWithFailure: true,
          isTail: true,
          truncated: true,
        });
      }).pipe(Effect.provide(world))
  );

  it.effect("cuts a long log between characters, never inside one", () =>
    Effect.gen(function* () {
      // Each "é" is two bytes, so 256 KiB from the end falls inside one.
      const long = `${"é".repeat(150 * 1024)}x`;
      const api = yield* answered(long);
      const read = yield* api.evidence(alice, bobsLog);

      expect({
        bytes: new TextEncoder().encode(read.text).length,
        isTail: long.endsWith(read.text),
        truncated: read.truncated,
      }).toStrictEqual({
        bytes: 256 * 1024 - 1,
        isTail: true,
        truncated: true,
      });
    }).pipe(Effect.provide(world))
  );
});
