/**
 * The rules' facts at a commit, as the platform reads them through
 * `RepoHost`: the files handed to the judge closure are what `@repo/checks`'
 * `judgeInputs` gathers, the same function the CLI's local check and hook
 * gather through, so the closure the gateway judges a push by is the one
 * every file of the tree gives (one home for the policy facts).
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import { isJudged, judgeClosure } from "@repo/checks/judge";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Command } from "@repo/protocol/domain/common";
import type { RunBlock } from "@repo/protocol/domain/run";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { TouchedJudge } from "@repo/protocol/refusal";
import { advanceTo, at } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Effect, Option } from "effect";

import { evaluationFacts } from "../src/facts.ts";
import { projectService } from "../src/project.ts";
import { CheckScript, composedAt, Pusher, worldOf } from "./world.ts";

const project = ProjectName.make("kit");

const repo = RepoName.make(project);

/**
 * A tree whose judge reaches past the root and the CI folders: lefthook
 * runs `scripts/pre-commit.sh`, which runs a hook script with a helper;
 * Claude Code's settings run `scripts/hooks/shell-policy.ts`; a package's
 * tsconfig extends the root base and a file of its own; oxlint loads a
 * plugin that imports a helper; a test outside the plugin's folder names
 * it; and product code nothing reaches.
 */
const tree: Files = [
  ["package.json", JSON.stringify({ name: "kit", workspaces: ["packages/*"] })],
  [
    "lefthook.yml",
    "pre-commit:\n  commands:\n    guard:\n      run: sh scripts/pre-commit.sh\n",
  ],
  ["scripts/pre-commit.sh", "#!/bin/sh\nbun scripts/hooks/guard.ts\n"],
  [
    "scripts/hooks/guard.ts",
    'import { policy } from "./lib/policy.ts";\n\npolicy();\n',
  ],
  ["scripts/hooks/lib/policy.ts", "export const policy = () => 0;\n"],
  [
    ".claude/settings.json",
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { command: "bun scripts/hooks/shell-policy.ts", type: "command" },
            ],
          },
        ],
      },
    }),
  ],
  ["scripts/hooks/shell-policy.ts", "export {};\n"],
  ["tsconfig.base.json", JSON.stringify({ compilerOptions: {} })],
  ["packages/a/package.json", JSON.stringify({ name: "@kit/a" })],
  [
    "packages/a/tsconfig.json",
    JSON.stringify({ extends: ["../../tsconfig.base.json", "./build.json"] }),
  ],
  ["packages/a/build.json", JSON.stringify({ compilerOptions: {} })],
  ["packages/a/src/index.ts", "export const a = 1;\n"],
  [
    "oxlint.config.ts",
    'export default { jsPlugins: ["./tools/lint/plugin.ts"] };\n',
  ],
  [
    "tools/lint/plugin.ts",
    'import { rule } from "./helper.ts";\n\nexport default { rules: { rule } };\n',
  ],
  ["tools/lint/helper.ts", "export const rule = {};\n"],
  [
    "test/plugin-cases.test.ts",
    'import plugin from "../tools/lint/plugin.ts";\n\nplugin;\n',
  ],
  ["src/app.ts", 'import { a } from "@kit/a";\n\nexport const app = a;\n'],
];

const run: RunBlock = { checks: {}, test: Command.make("bun test {path}") };

/** `tree` committed and pushed to the project's repo, as its first commit. */
const pushed = Effect.gen(function* () {
  const host = yield* RepoHost;
  const client = yield* gitClient(memoryFs());

  yield* host.create(repo).pipe(Effect.orDie);

  const sha = CommitSha.make(yield* client.commit("Start", tree, []));

  yield* host
    .push(repo, client.source, [
      { from: Option.none(), ref: RefName.make("refs/heads/main"), to: sha },
    ])
    .pipe(Effect.orDie);

  return sha;
});

const factsOfTree = Effect.gen(function* () {
  const sha = yield* pushed;

  return yield* evaluationFacts(repo, sha, {
    initializer: Handle.make("alice"),
    now: at("2026-10-07T12:00:00Z"),
    project,
    vouchFile: RepoPath.make(`${Brand.configDir}/vouched.td`),
  });
}).pipe(Effect.provide(RepoHostMemory));

describe(evaluationFacts, () => {
  it.effect(
    "hands the judge closure hook scripts, the tsconfig chain, plugin imports and rule fixture tests",
    () =>
      Effect.gen(function* () {
        const facts = yield* factsOfTree;
        const closure = judgeClosure(run, facts.ci);

        expect(
          [
            "scripts/pre-commit.sh",
            "scripts/hooks/guard.ts",
            "scripts/hooks/lib/policy.ts",
            "scripts/hooks/shell-policy.ts",
            "tsconfig.base.json",
            "packages/a/build.json",
            "tools/lint/plugin.ts",
            "tools/lint/helper.ts",
            "test/plugin-cases.test.ts",
          ].filter((path) => !isJudged(closure, path))
        ).toStrictEqual([]);
        expect(
          ["src/app.ts", "packages/a/src/index.ts"].filter((path) =>
            isJudged(closure, path)
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "gives the closure every file of the tree gives, as the CLI's local check does",
    () =>
      Effect.gen(function* () {
        const facts = yield* factsOfTree;

        expect(judgeClosure(run, facts.ci)).toStrictEqual(
          judgeClosure(
            run,
            tree.map(([path, content]) => ({ content, path }))
          )
        );
      })
  );

  it.effect("still reads the workspaces the root manifest declares", () =>
    Effect.gen(function* () {
      const facts = yield* factsOfTree;

      expect(facts.workspaces).toStrictEqual([
        { dir: "packages/a", exports: [], name: "@kit/a" },
      ]);
    })
  );
});

// ------------------------------------------------------------ through the gate

const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const gatedRepo = RepoName.make(scenario.project);

const mainRef = RefName.make("refs/heads/main");

const parseIso = AskId.make("parse-iso");

const alice = Person.make({ handle: scenario.initializer });

const bob = Person.make({
  handle: scenario.people.get("bob") ?? scenario.initializer,
});

const bobFork = RepoName.make(
  `${scenario.project}--${parseIso}--${bob.handle}`
);

const ask = Option.getOrThrow(
  Array.findFirst(scenario.policy.asks, ({ id }) => id === parseIso)
);

/** The ask's own files: its file in the config folder, and its check. */
const askFiles = Array.make(
  { content: `export default "${parseIso}";\n`, path: ask.file },
  {
    content: 'import { it } from "vitest";\n\nit("parses a year", () => {});\n',
    path: CheckSpec.guards.RedThenGreen(ask.check)
      ? ask.check.path
      : RepoPath.make("test/parse-iso.test.ts"),
  }
);

/**
 * A project whose harness hook config sits in a subfolder, not at the root
 * or in a CI folder, and runs a script outside both.
 */
const hooked: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/package.json", '{ "name": "parser" }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => 0;\n"],
  [
    ".claude/settings.json",
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { command: "bun scripts/hooks/shell-policy.ts", type: "command" },
            ],
          },
        ],
      },
    }),
  ],
  ["scripts/hooks/shell-policy.ts", "export {};\n"],
];

/**
 * alice makes the project and opens parse-iso red first; bob claims it and
 * pushes an edit to the script the hook config runs. What the gate says.
 */
const hookScriptPushed = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(scenario.project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(gatedRepo, Option.none(), hooked, "Start")
  );

  yield* api.recordFirstPush(alice, first);

  const composed = yield* composedAt(
    gatedRepo,
    LandedSha.make(first),
    askFiles
  );

  yield* CheckScript.use((checker) =>
    checker.script(composed, LaneName.make("redThenGreen"), [
      "failed",
      "failed",
    ])
  );

  const { landed } = yield* api.openAsk(alice, {
    ask: parseIso,
    files: askFiles,
  });

  yield* api.claim(bob, parseIso);

  const head = yield* Pusher.use((pusher) =>
    pusher.push(bobFork, Option.some(landed), [
      ...hooked.filter(([path]) => path !== "scripts/hooks/shell-policy.ts"),
      ...askFiles.map(({ content, path }) => [path, content] as const),
      ["scripts/hooks/shell-policy.ts", "process.exit(0);\n"],
    ])
  );

  return yield* api.recordPush({
    after: head,
    before: Option.some(landed),
    eventId: "push-hook-script",
    pusher: bob,
    ref: mainRef,
    repo: bobFork,
  });
}).pipe(Effect.provide(worldOf(scenario, "memory")));

describe("a claimant's push, judged by these facts", () => {
  it.effect(
    "is refused TouchedJudge for an edit to a script a hook config runs, as the local hook refuses it",
    () =>
      Effect.map(hookScriptPushed, (refusals) => {
        expect(refusals).toStrictEqual([
          new TouchedJudge({
            paths: [RepoPath.make("scripts/hooks/shell-policy.ts")],
          }),
        ]);
      }),
    // Real git objects and every gate stage: the limit catches a hang.
    { timeout: 30_000 }
  );
});
