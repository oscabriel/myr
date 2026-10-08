/**
 * The rules' facts at a commit, as the platform reads them through
 * `RepoHost`: the files handed to the judge closure are what `@repo/checks`'
 * `judgeInputs` gathers, the same function the CLI's local check and hook
 * gather through, so the closure the gateway judges a push by is the one
 * every file of the tree gives (spec §8.5, "one home for the policy facts").
 */
import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import { isJudged, judgeClosure } from "@repo/checks/judge";
import { Command } from "@repo/protocol/domain/common";
import type { RunBlock } from "@repo/protocol/domain/run";
import {
  CommitSha,
  Handle,
  ProjectName,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import { at } from "@repo/testkit/clock";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { Effect, Option } from "effect";

import { evaluationFacts } from "../src/facts.ts";

const project = ProjectName.make("kit");

const repo = RepoName.make(project);

/**
 * A tree whose judge reaches past the root and the CI folders: lefthook
 * runs `scripts/pre-commit.sh`, which runs a hook script with a helper;
 * Claude Code's settings run `scripts/hooks/vcs-policy.ts`; a package's
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
              { command: "bun scripts/hooks/vcs-policy.ts", type: "command" },
            ],
          },
        ],
      },
    }),
  ],
  ["scripts/hooks/vcs-policy.ts", "export {};\n"],
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
            "scripts/hooks/vcs-policy.ts",
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
