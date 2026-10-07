import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import oxlintConfig from "../../../oxlint.config.ts";
import type { Kind } from "../../../scripts/lib/debt.ts";
import {
  ledgerArgs,
  ledgerFromOxlintJson,
  rises,
  tally,
  Tally,
} from "../../../scripts/lib/debt.ts";
import { drift, generate, Refusal } from "../../../scripts/lib/gen.ts";
import { findViolations } from "../../../scripts/lib/imports.ts";
import { repoRoot } from "./root.ts";

const readRootJson = <S extends Schema.Top>(file: string, schema: S) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const text = yield* fs.readFileString(path.join(root, file));

    return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(text);
  });

const RootPackage = Schema.Struct({
  scripts: Schema.Struct({ verify: Schema.String }),
});

/**
 * What `fence/debt-ledger` reports as one diagnostic's message. The rule
 * reports at the file's first offset, so the escape's line is in the message.
 */
const message = (
  directive: string,
  kind: string,
  line: number,
  reason?: string
) => JSON.stringify({ column: 3, directive, kind, line, reason });

const entry = (kind: Kind, line: number) => ({
  directive: kind,
  kind,
  line,
  path: "packages/x/src/a.ts",
});

const refusalsDoc = () =>
  generate().find((file) => file.path === "docs/reference/refusals.md");

describe("verify", () => {
  it.live("runs every fence step, in order", () =>
    Effect.gen(function* () {
      const { scripts } = yield* readRootJson("package.json", RootPackage);

      expect(
        scripts.verify.split(" && ").map((step) => step.replace("bun run ", ""))
      ).toStrictEqual([
        "lockfile:check",
        "check",
        "typecheck",
        "test",
        "gen:check",
        "imports:check",
        "debt",
        "brand:check",
        "bytes:check",
      ]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the debt count", () => {
  it.live(
    "matches debt.baseline.json over the tree as it stands",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const root = yield* repoRoot;
        const baseline = yield* readRootJson("debt.baseline.json", Tally);

        const report = yield* spawner.string(
          ChildProcess.make(
            path.join(root, "node_modules/.bin/oxlint"),
            ledgerArgs,
            { cwd: root }
          )
        );

        const ledger = yield* ledgerFromOxlintJson(report);

        expect(tally(ledger)).toStrictEqual(baseline);
      }).pipe(Effect.provide(NodeServices.layer)),
    // oxlint over the whole tree, which grows each wave: under half a second
    // alone, near four while turbo runs every package's tests at once. The
    // limit catches a hang.
    30_000
  );

  it.effect(
    "reads each directive, and its line, from oxlint's JSON report",
    () =>
      Effect.gen(function* () {
        const report = JSON.stringify({
          diagnostics: [
            {
              code: "fence(debt-ledger)",
              filename: "packages/x/src/a.ts",
              labels: [{ span: { column: 1, length: 0, line: 1, offset: 0 } }],
              message: message(
                "oxlint-disable-next-line no-console",
                "oxlint-disable",
                12,
                "the CLI prints"
              ),
              severity: "error",
            },
            {
              code: "fence(debt-ledger)",
              filename: "packages/x/test/b.test.ts",
              labels: [{ span: { column: 1, length: 0, line: 1, offset: 0 } }],
              message: message("@ts-nocheck", "@ts-nocheck", 1),
              severity: "error",
            },
          ],
          number_of_files: 2,
          number_of_rules: 1,
        });

        const ledger = yield* ledgerFromOxlintJson(report);

        expect(ledger).toStrictEqual([
          {
            directive: "oxlint-disable-next-line no-console",
            kind: "oxlint-disable",
            line: 12,
            path: "packages/x/src/a.ts",
            reason: "the CLI prints",
          },
          {
            directive: "@ts-nocheck",
            kind: "@ts-nocheck",
            line: 1,
            path: "packages/x/test/b.test.ts",
          },
        ]);
      })
  );

  it.effect("refuses a report that is not oxlint's JSON", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ledgerFromOxlintJson('{"diagnostics":[{"message":"not json"}]}')
      );

      expect(error._tag).toBe("SchemaError");
    })
  );

  it("counts every kind, and names each kind that rose above its baseline", () => {
    const baseline = {
      "@effect-diagnostics": 1,
      "@ts-expect-error": 0,
      "@ts-ignore": 0,
      "@ts-nocheck": 0,
      "oxlint-disable": 1,
    };

    const counted = tally([
      entry("oxlint-disable", 1),
      entry("oxlint-disable", 2),
      entry("@ts-expect-error", 3),
    ]);

    expect(counted).toStrictEqual({
      "@effect-diagnostics": 0,
      "@ts-expect-error": 1,
      "@ts-ignore": 0,
      "@ts-nocheck": 0,
      "oxlint-disable": 2,
    });
    expect(rises(counted, baseline)).toStrictEqual([
      { baseline: 1, count: 2, kind: "oxlint-disable" },
      { baseline: 0, count: 1, kind: "@ts-expect-error" },
    ]);
    expect(rises(baseline, baseline)).toStrictEqual([]);
  });
});

describe("the lint config", () => {
  const fence = { name: "fence", specifier: "./tools/oxlint/fence/index.ts" };

  it("runs the fence plugin's rules at error, but not the debt ledger", () => {
    const enabled = [
      ...Object.keys(oxlintConfig.rules ?? {}),
      ...(oxlintConfig.overrides ?? []).flatMap((override) =>
        Object.keys(override.rules ?? {})
      ),
    ];

    expect(oxlintConfig.jsPlugins).toContainEqual(fence);
    expect(oxlintConfig.rules).toMatchObject({
      "fence/no-effect-sleep-in-project": "error",
      "fence/no-manual-effect-runtime-in-tests": "error",
      "fence/no-module-level-mutable-state": "error",
    });
    expect(enabled).not.toContain("fence/debt-ledger");
  });
});

describe("generation", () => {
  it("writes a refusals reference with a section for every tag in the union", () => {
    const headings = (refusalsDoc()?.content ?? "")
      .split("\n")
      .filter((line) => line.startsWith("### "));

    expect(headings).toStrictEqual(
      Refusal.members.map((member) => `### ${member.identifier}`)
    );
  });

  it("says whether retrying helps and what to run next", () => {
    const content = refusalsDoc()?.content ?? "";
    const staleBase = content.slice(content.indexOf("### StaleBase"));

    expect(staleBase).toContain("- Retryable: yes");
    expect(staleBase).toContain("- Next: `git pull --rebase`");
  });

  it("tells stale, missing and extra files apart", () => {
    expect(
      drift(
        [
          { content: "same\n", path: "docs/reference/a.md" },
          { content: "new\n", path: "docs/reference/b.md" },
          { content: "new\n", path: "docs/reference/c.md" },
        ],
        [
          { content: "same\n", path: "docs/reference/a.md" },
          { content: "old\n", path: "docs/reference/b.md" },
          { content: "stray\n", path: "skills/d/SKILL.md" },
        ]
      )
    ).toStrictEqual({
      extra: ["skills/d/SKILL.md"],
      missing: ["docs/reference/c.md"],
      stale: ["docs/reference/b.md"],
    });
  });
});

describe("import direction", () => {
  const workspaces = [
    { dependencies: ["@repo/protocol"], dir: "apps/cli", name: "@repo/cli" },
    {
      dependencies: ["@repo/protocol"],
      dir: "apps/platform",
      name: "@repo/platform",
    },
    { dependencies: [], dir: "packages/protocol", name: "@repo/protocol" },
  ];

  it("refuses an app that imports another app, by name or by path", () => {
    const content = [
      'import { serve } from "@repo/protocol/contracts";',
      'import { mcp } from "@repo/cli/surfaces";',
      'export { stdio } from "../../cli/test/stdio.ts";',
      'const later = import("@repo/cli");',
    ].join("\n");

    expect(
      findViolations(
        [{ content, path: "apps/platform/src/worker.ts" }],
        workspaces
      )
    ).toStrictEqual([
      {
        line: 2,
        path: "apps/platform/src/worker.ts",
        rule: "app-imports-app",
        specifier: "@repo/cli/surfaces",
      },
      {
        line: 3,
        path: "apps/platform/src/worker.ts",
        rule: "app-imports-app",
        specifier: "../../cli/test/stdio.ts",
      },
      {
        line: 4,
        path: "apps/platform/src/worker.ts",
        rule: "app-imports-app",
        specifier: "@repo/cli",
      },
    ]);
  });

  it("lets an app import packages and its own files", () => {
    const content = [
      'import { Refusal } from "@repo/protocol/refusal";',
      'import { serve } from "./surfaces.ts";',
      'import type { Effect } from "effect";',
    ].join("\n");

    expect(
      findViolations(
        [{ content, path: "apps/platform/src/worker.ts" }],
        workspaces
      )
    ).toStrictEqual([]);
  });
});
