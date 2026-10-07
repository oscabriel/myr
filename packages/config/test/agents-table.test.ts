import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Repo, Sources } from "./agents-table.ts";
import {
  missingEnforcers,
  principleRows,
  readAgentsTable,
  repoOf,
} from "./agents-table.ts";

/** A repo with one enforcer of each kind, and nothing else. */
const plantedRepo: Repo = {
  configKeys: ["allowedUnstableApis"],
  diagnosticsAtError: ["globalDate"],
  files: [
    ".pi/extensions/vcs-policy/index.ts",
    "apps/cli/src/surfaces.ts",
    "debt.baseline.json",
    "scripts/gen.ts",
  ],
  ids: ["AskId"],
  lintPlugins: ["eslint", "fence"],
  lintRulesAtError: [
    "fence/no-module-level-mutable-state",
    "no-restricted-imports",
  ],
  refusals: ["StaleBase"],
  scripts: ["gen:check", "verify"],
};

/** A file whose principles table has one row, principle 4, held by `cell`. */
const plantedTable = (cell: string) =>
  [
    "# A repo",
    "",
    "## Principles",
    "",
    "| # | Principle | Held by |",
    "| --- | --- | --- |",
    `| 4 | **One schema, many surfaces.** | ${cell} |`,
    "",
    "## Fence",
    "",
  ].join("\n");

const audit = (cell: string) =>
  principleRows(plantedTable(cell)).flatMap((row) =>
    missingEnforcers(row, plantedRepo)
  );

describe("the agents-table check, over a planted table", () => {
  it("fails each enforcer the repo lacks, naming its row", () => {
    expect(
      audit(
        "`scripts/nope.ts`; `nope:check`; `fence/nope`; `globalNope`; `NopeRefusal`"
      )
    ).toStrictEqual([
      "principle 4 names `scripts/nope.ts`, but the repo has no such file",
      "principle 4 names `nope:check`, but the repo has no such root package.json script",
      "principle 4 names `fence/nope`, but the repo has no such lint rule at error in oxlint.config.ts",
      "principle 4 names `globalNope`, but the repo has no such Effect diagnostic at error in tsconfig.base.json or key in tsconfig.base.json",
      "principle 4 names `NopeRefusal`, but the repo has no such refusal class in packages/protocol/src/refusal.ts or id exported from packages/protocol/src/ids.ts",
    ]);
  });

  it("passes an enforcer of each kind that exists", () => {
    expect(
      audit(
        [
          "`scripts/gen.ts`, `apps/*/src/surfaces.ts`, `scripts/{debt,gen}.ts`, `.pi/extensions/vcs-policy/` and `debt.baseline.json`;",
          "`bun run verify` and `gen:check`;",
          "`fence/no-module-level-mutable-state`, `no-module-level-mutable-state` and `no-restricted-imports`;",
          "`globalDate` and `allowedUnstableApis`; `StaleBase` and `AskId`",
        ].join(" ")
      )
    ).toStrictEqual([]);
  });

  it("reads nothing after No fence yet", () => {
    expect(
      audit(
        "`gen:check`. No fence yet: `scripts/nope.ts` and `nope:check` (W9 901)"
      )
    ).toStrictEqual([]);
  });

  it("fails a row that names no enforcer and says no fence is coming", () => {
    expect(audit("The union test and an MCP tools/call test")).toStrictEqual([
      "principle 4 names no enforcer; name one, or what will hold it after No fence yet:",
    ]);
  });

  it("passes a row whose every enforcer is still to come", () => {
    expect(audit("No fence yet: the union test (W9 901)")).toStrictEqual([]);
  });

  it("fails an enforcer it cannot classify", () => {
    expect(audit("`git push --force`")).toStrictEqual([
      "unclassified enforcer `git push --force` in principle 4; name a file, script, rule, diagnostic or tag",
    ]);
  });

  it("reads only the Held by cells of the table under Principles", () => {
    const markdown = [
      "# A repo",
      "",
      "Prose names `scripts/prose.ts`.",
      "",
      "## Principles",
      "",
      "A preamble names `scripts/preamble.ts`.",
      "",
      "| # | Principle | Held by |",
      "| --- | --- | --- |",
      "| 1 | **A rule** named in `scripts/principle.ts`. | `verify` |",
      "| 2 | **Another rule.** | `a\\|b` and `gen:check` |",
      "",
      "## Fence",
      "",
      "| # | Rule | Held by |",
      "| --- | --- | --- |",
      "| 3 | Another table. | `scripts/elsewhere.ts` |",
    ].join("\n");

    expect(principleRows(markdown)).toStrictEqual([
      { enforcers: ["verify"], principle: "1", waiting: false },
      { enforcers: ["a|b", "gen:check"], principle: "2", waiting: false },
    ]);
  });
});

/**
 * Sources shaped like the repo's: a lint preset our config extends and
 * overrides, and a test-file override that turns on its own plugin.
 */
const plantedSources: Sources = {
  files: [],
  idsSource: [
    'export const AskId = Schema.String.pipe(Schema.brand("AskId"));',
    "export type AskId = typeof AskId.Type;",
  ].join("\n"),
  oxlint: {
    extends: [
      {
        plugins: ["eslint", "typescript"],
        rules: { "no-alert": "error", "no-console": "error" },
      },
    ],
    overrides: [
      {
        files: ["**/*.test.ts"],
        plugins: ["vitest"],
        rules: { "vitest/no-disabled-tests": ["error"] },
      },
    ],
    rules: { "no-console": "off", "typescript/no-explicit-any": "warn" },
  },
  refusalSource: [
    'export class StaleBase extends Schema.TaggedError<StaleBase>()("StaleBase", {}) {}',
    "export const Refusal = Schema.Union([StaleBase]);",
  ].join("\n"),
  rootPackage: JSON.stringify({ scripts: { verify: "bun run check" } }),
  tsconfig: JSON.stringify({
    compilerOptions: {
      plugins: [
        {
          allowedUnstableApis: ["effect/rpc"],
          diagnosticSeverity: { globalDate: "error", globalRandom: "off" },
          name: "@effect/language-service",
        },
      ],
    },
  }),
};

const auditSources = (cell: string) =>
  Effect.map(repoOf(plantedSources), (repo) =>
    principleRows(plantedTable(cell)).flatMap((row) =>
      missingEnforcers(row, repo)
    )
  );

describe("what the repo holds, read from planted sources", () => {
  it.effect(
    "counts a lint rule as on only at error after every layer, overrides included",
    () =>
      Effect.gen(function* () {
        expect(
          yield* auditSources(
            "`no-alert`, `no-console`, `typescript/no-explicit-any` and `vitest/no-disabled-tests`"
          )
        ).toStrictEqual([
          "principle 4 names `no-console`, but the repo has no such lint rule at error in oxlint.config.ts or root package.json script",
          "principle 4 names `typescript/no-explicit-any`, but the repo has no such lint rule at error in oxlint.config.ts",
        ]);
      })
  );

  it.effect(
    "counts a diagnostic as on only at error, and never as a config key",
    () =>
      Effect.gen(function* () {
        expect(
          yield* auditSources(
            "`globalDate`, `globalRandom` and `allowedUnstableApis`"
          )
        ).toStrictEqual([
          "principle 4 names `globalRandom`, but the repo has no such Effect diagnostic at error in tsconfig.base.json or key in tsconfig.base.json",
        ]);
      })
  );

  it.effect(
    "reads root scripts, refusal classes and exported ids, and nothing else",
    () =>
      Effect.gen(function* () {
        expect(
          yield* auditSources("`verify`, `StaleBase`, `AskId` and `Refusal`")
        ).toStrictEqual([
          "principle 4 names `Refusal`, but the repo has no such refusal class in packages/protocol/src/refusal.ts or id exported from packages/protocol/src/ids.ts",
        ]);
      })
  );
});

// The rows are known only once a test has read AGENTS.md, so one test checks
// every row; each line it reports names its principle.
describe("AGENTS.md's principles table", () => {
  it.live("is under ## Principles, with a Held by column", () =>
    Effect.gen(function* () {
      const { rows } = yield* readAgentsTable;

      expect(rows).not.toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("names, in every row, only enforcers the repo has", () =>
    Effect.gen(function* () {
      const { repo, rows } = yield* readAgentsTable;

      expect(rows.flatMap((row) => missingEnforcers(row, repo))).toStrictEqual(
        []
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
