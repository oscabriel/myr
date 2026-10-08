/**
 * `judgeInputs`: the files the finder and the judge closure are handed,
 * chosen from a commit's listing by reading only what their walks reach.
 * The platform's facts and the CLI's local check both gather them through
 * it, so the closure over its files must be the closure over every file.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Command } from "@repo/protocol/domain/common";
import type { RunBlock } from "@repo/protocol/domain/run";
import { LaneName } from "@repo/protocol/ids";
import { Effect, Ref } from "effect";

import type { RepoFile } from "../src/finder.ts";
import {
  isJudged,
  judgeClosure,
  judgeInputs,
  MAX_FACT_BYTES,
} from "../src/judge.ts";
import type { ListedFile } from "../src/judge.ts";

const file = (path: string, content: string): RepoFile => ({ content, path });

/**
 * A small monorepo whose judge reaches past the root: a hook config naming a
 * shell script that runs a hook script with a helper, a package tsconfig
 * extending the base and a file of its own, a lint plugin with a helper and
 * a test elsewhere that names it, a config folder whose run block names a
 * check script with a helper beside it, and product code nothing reaches.
 */
const tree: readonly RepoFile[] = [
  file(
    "package.json",
    JSON.stringify({ name: "kit", workspaces: ["packages/*"] })
  ),
  file(
    "lefthook.yml",
    "pre-commit:\n  commands:\n    guard:\n      run: sh scripts/pre-commit.sh\n"
  ),
  file("scripts/pre-commit.sh", "#!/bin/sh\nbun scripts/hooks/guard.ts\n"),
  file(
    "scripts/hooks/guard.ts",
    'import { policy } from "./lib/policy.ts";\n\npolicy();\n'
  ),
  file("scripts/hooks/lib/policy.ts", "export const policy = () => 0;\n"),
  file(
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
    })
  ),
  file("scripts/hooks/shell-policy.ts", "export {};\n"),
  file("tsconfig.base.json", JSON.stringify({ compilerOptions: {} })),
  file("packages/a/package.json", JSON.stringify({ name: "@kit/a" })),
  file(
    "packages/a/tsconfig.json",
    JSON.stringify({ extends: ["../../tsconfig.base.json", "./build.json"] })
  ),
  file("packages/a/build.json", JSON.stringify({ compilerOptions: {} })),
  file("packages/a/src/index.ts", "export const a = 1;\n"),
  file(
    "oxlint.config.ts",
    'export default { jsPlugins: ["./tools/lint/plugin.ts"] };\n'
  ),
  file(
    "tools/lint/plugin.ts",
    'import { rule } from "./helper.ts";\n\nexport default { rules: { rule } };\n'
  ),
  file("tools/lint/helper.ts", "export const rule = {};\n"),
  file(
    "test/plugin-cases.test.ts",
    'import plugin from "../tools/lint/plugin.ts";\n\nplugin;\n'
  ),
  file(
    `${Brand.configDir}/project.ts`,
    'export default project({ run: { checks: { api: "bun scripts/check/api.ts" }, test: "bun test {path}" } });\n'
  ),
  file(
    "scripts/check/api.ts",
    'import { surface } from "./surface.ts";\n\nsurface();\n'
  ),
  file("scripts/check/surface.ts", "export const surface = () => 0;\n"),
  file("src/app.ts", 'import { a } from "@kit/a";\n\nexport const app = a;\n'),
];

/** The run block the config folder above declares. */
const run: RunBlock = {
  checks: { [LaneName.make("api")]: Command.make("bun scripts/check/api.ts") },
  test: Command.make("bun test {path}"),
};

const encoder = new TextEncoder();

const listingOf = (files: readonly RepoFile[]): readonly ListedFile[] =>
  files.map(({ path }) => ({ path }));

/** `judgeInputs` over `files`, and every path it asked to read, batch by batch. */
const gathered = (
  files: readonly RepoFile[],
  listing: readonly ListedFile[] = listingOf(files)
) =>
  Effect.gen(function* () {
    const asked = yield* Ref.make<readonly (readonly string[])[]>([]);
    const byPath = new Map(files.map(({ content, path }) => [path, content]));

    const inputs = yield* judgeInputs(listing, (paths) =>
      Effect.as(
        Ref.update(asked, (batches) => [...batches, paths]),
        paths.flatMap((path) => {
          const content = byPath.get(path);

          return content === undefined
            ? []
            : [{ bytes: encoder.encode(content), path }];
        })
      )
    );

    return { asked: yield* Ref.get(asked), inputs };
  });

describe(judgeInputs, () => {
  it.effect(
    "gives the closure every file gives: hook scripts, the tsconfig chain, plugin imports and rule fixture tests",
    () =>
      Effect.gen(function* () {
        const { inputs } = yield* gathered(tree);
        const closure = judgeClosure(run, inputs);

        expect(closure).toStrictEqual(judgeClosure(run, tree));
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
            "scripts/check/api.ts",
            "scripts/check/surface.ts",
          ].filter((path) => !isJudged(closure, path))
        ).toStrictEqual([]);
        expect(closure.notes).toBeUndefined();
      })
  );

  it.effect(
    "lists every path, and reads only what the walks reach, each once",
    () =>
      Effect.gen(function* () {
        const { asked, inputs } = yield* gathered(tree);
        const read = asked.flat();

        expect(inputs.map(({ path }) => path)).toStrictEqual(
          tree.map(({ path }) => path).toSorted()
        );
        expect(read.toSorted()).toStrictEqual([...new Set(read)].toSorted());
        expect(
          ["src/app.ts", "packages/a/src/index.ts"].filter((path) =>
            read.includes(path)
          )
        ).toStrictEqual([]);
        expect(inputs.filter(({ path }) => !read.includes(path))).toStrictEqual(
          [file("packages/a/src/index.ts", ""), file("src/app.ts", "")]
        );
      })
  );

  it.effect(
    "never reads a file the listing says is over 256 KiB, and empties one the reader finds is",
    () =>
      Effect.gen(function* () {
        const big = "x".repeat(MAX_FACT_BYTES + 1);

        const files = [
          file("package.json", JSON.stringify({ name: "kit" })),
          file("bun.lock", big),
          file("lefthook.yml", big),
        ];

        const { asked, inputs } = yield* gathered(files, [
          { path: "package.json", size: 16 },
          { path: "bun.lock", size: big.length },
          { path: "lefthook.yml" },
        ]);

        expect({ asked: asked.flat().toSorted(), inputs }).toStrictEqual({
          asked: ["lefthook.yml", "package.json"],
          inputs: [
            file("bun.lock", ""),
            file("lefthook.yml", ""),
            file("package.json", JSON.stringify({ name: "kit" })),
          ],
        });
      })
  );

  it.effect("reads nothing for an empty listing", () =>
    Effect.gen(function* () {
      expect(yield* gathered([])).toStrictEqual({ asked: [], inputs: [] });
    })
  );
});
