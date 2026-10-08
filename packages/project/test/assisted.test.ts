/**
 * `Assisted-by:` on an answer's landing (spec D18, synthesis §3.2 "Agent
 * trailer"): every harness that pushed to the claim, as each push's custody
 * named it, once each, in the order they first pushed; none when the
 * project's policy says `agents: "none"`, and none for a push no harness
 * named. The harness is audit metadata: the person who pushed stays the
 * landing's author and only credited name.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { creditsOf } from "@repo/git/trailers";
import type { HarnessAudit } from "@repo/protocol/audit";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  LandedSha,
  LaneName,
  RepoName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Effect, Option } from "effect";

import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { CheckScript, composedAt, mergedAt, Pusher, worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(project);

const mainRef = RefName.make("refs/heads/main");

const parseIso = AskId.make("parse-iso");

const alice = Person.make({ handle: scenario.initializer });

const bob = Person.make({
  handle: scenario.people.get("bob") ?? scenario.initializer,
});

const bobFork = RepoName.make(`${project}--${parseIso}--${bob.handle}`);

const lanes = [
  LaneName.make("redThenGreen"),
  LaneName.make("lint"),
  LaneName.make("types"),
];

const ask: Ask = Option.getOrThrow(
  Array.findFirst(scenario.policy.asks, ({ id }) => id === parseIso)
);

/** The ask's own files: its file in the config folder, and its check. */
const askFiles = Array.make(
  { content: `export default "${parseIso}";\n`, path: ask.file },
  {
    content: [
      `import { expect, it } from "vitest";`,
      `import { parse } from "../src/parse.ts";`,
      ``,
      `it("parses a year", () => {`,
      `  expect(parse("2026")).toBe(2026);`,
      `});`,
      ``,
    ].join("\n"),
    path: CheckSpec.guards.RedThenGreen(ask.check)
      ? ask.check.path
      : RepoPath.make("test/parse-iso.test.ts"),
  }
);

const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/package.json", '{ "name": "parser" }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => 0;\n"],
];

/** Main once the ask opened on it, with the parser at `step`. */
const answerAt = (step: number): Files => [
  ...start.filter(([path]) => path !== "packages/parser/src/parse.ts"),
  ...askFiles.map(({ content, path }) => [path, content] as const),
  [
    "packages/parser/src/parse.ts",
    `export const parse = (s) => Number(s); // step ${step}\n`,
  ],
];

const mainTip = Effect.gen(function* () {
  const refs = yield* (yield* RepoHost).refs(repo).pipe(Effect.orDie);

  return LandedSha.make(
    Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
  );
});

/** The project made and first pushed by alice, and parse-iso opened red first. */
const opened = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* api.initProject(alice, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(repo, Option.none(), start, "Start")
    );

    yield* api.recordFirstPush(alice, first);

    const composed = yield* composedAt(repo, yield* mainTip, askFiles);

    yield* CheckScript.use((checker) =>
      checker.script(composed, LaneName.make("redThenGreen"), [
        "failed",
        "failed",
      ])
    );

    return (yield* api.openAsk(alice, { ask: parseIso, files: askFiles }))
      .landed;
  });

/**
 * bob claims parse-iso and pushes once per entry of `pushes`, each push
 * reported by custody with the harness it named (or none); the last head is
 * checked green and submitted. With `claimedAnewAt`, bob releases his claim
 * and claims the ask again before that push. What lands: its trailers and
 * its view.
 */
const answered = (
  policy: Policy,
  pushes: readonly Option.Option<HarnessAudit>[],
  claimedAnewAt?: number
) =>
  Effect.gen(function* () {
    yield* advanceTo("2026-10-07T12:00:00Z");

    const api = yield* projectService(project);
    const base = yield* opened(api);

    yield* api.claim(bob, parseIso);

    const heads = yield* Effect.reduce(
      pushes,
      (): readonly CommitSha[] => [],
      (done, audit, step) =>
        Effect.gen(function* () {
          if (step === claimedAnewAt) {
            yield* api.release(bob, parseIso);
            yield* api.claim(bob, parseIso);
          }

          const parent = Option.getOrElse(
            Option.fromUndefinedOr(done.at(-1)),
            (): CommitSha => base
          );

          const head = yield* Pusher.use((pusher) =>
            pusher.push(bobFork, Option.some(parent), answerAt(step))
          );

          yield* api.recordPush({
            after: head,
            before: Option.some(parent),
            eventId: `push-${step}`,
            pusher: bob,
            ref: mainRef,
            repo: bobFork,
            ...Option.match(audit, {
              onNone: () => ({}),
              onSome: (named) => ({ audit: named }),
            }),
          });

          return [...done, head];
        })
    );

    const head = Option.getOrThrow(Option.fromUndefinedOr(heads.at(-1)));

    const merged = yield* mergedAt({
      base,
      fork: bobFork,
      head,
      main: base,
      repo,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        lanes,
        (lane) => checker.script(merged, lane, ["passed"]),
        {
          discard: true,
        }
      )
    );

    yield* api.submitAnswer(bob, {
      ask: parseIso,
      base,
      head,
      requestId: RequestId.make("req-assisted-0001"),
    });

    const landed = yield* mainTip;
    const host = yield* RepoHost;
    const commit = yield* host.readCommit(repo, landed).pipe(Effect.orDie);

    const { message } = Option.getOrThrow(commit);
    const { landing } = yield* api.landing(Anonymous.make({}), landed);

    return {
      author: landing.author,
      credited: creditsOf(message).credits.map(({ handle }) => handle),
      landedOn: landed === base ? "base" : "answer",
      trailers: message
        .split("\n")
        .filter((line) => line.startsWith("Assisted-by: ")),
      view: landing.assisted,
    };
  }).pipe(Effect.provide(worldOf({ policy }, "memory")));

const claudeCode = Option.some({ harness: "claude-code", model: "haiku" });

const pi = Option.some({ harness: "pi", model: "kimi-k3" });

/** A whole story's limit: real git objects and every gate stage, to catch a hang. */
const story = { timeout: 30_000 };

describe("Assisted-by on an answer's landing", () => {
  it.effect(
    "names each harness that pushed to the claim once, in the order they first pushed",
    () =>
      Effect.map(
        answered(scenario.policy, [claudeCode, pi, claudeCode]),
        (seen) => {
          expect(seen).toStrictEqual({
            author: bob.handle,
            credited: [alice.handle, bob.handle],
            landedOn: "answer",
            trailers: [
              "Assisted-by: claude-code:haiku (claimed)",
              "Assisted-by: pi:kimi-k3 (claimed)",
            ],
            view: [
              { harness: "claude-code", model: "haiku", verified: false },
              { harness: "pi", model: "kimi-k3", verified: false },
            ],
          });
        }
      ),
    story
  );

  it.effect(
    "names none when the project's policy says agents: none",
    () =>
      Effect.map(
        answered({ ...scenario.policy, agents: "none" }, [claudeCode, pi]),
        ({ landedOn, trailers, view }) => {
          expect({ landedOn, trailers, view }).toStrictEqual({
            landedOn: "answer",
            trailers: [],
            view: [],
          });
        }
      ),
    story
  );

  it.effect(
    "names none for pushes no harness named",
    () =>
      Effect.map(
        answered(scenario.policy, [Option.none(), Option.none()]),
        ({ landedOn, trailers, view }) => {
          expect({ landedOn, trailers, view }).toStrictEqual({
            landedOn: "answer",
            trailers: [],
            view: [],
          });
        }
      ),
    story
  );

  it.effect(
    "names only the harnesses that pushed since the ask was claimed anew",
    () =>
      Effect.map(
        answered(scenario.policy, [claudeCode, pi], 1),
        ({ landedOn, trailers }) => {
          expect({ landedOn, trailers }).toStrictEqual({
            landedOn: "answer",
            trailers: ["Assisted-by: pi:kimi-k3 (claimed)"],
          });
        }
      ),
    story
  );

  it.effect(
    "names a harness without a model by its harness alone",
    () =>
      Effect.map(
        answered(scenario.policy, [
          Option.none(),
          Option.some({ harness: "codex" }),
        ]),
        ({ trailers }) => {
          expect(trailers).toStrictEqual(["Assisted-by: codex (claimed)"]);
        }
      ),
    story
  );
});
