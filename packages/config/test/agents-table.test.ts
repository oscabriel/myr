import { describe, expect, it } from "@effect/vitest";

import type { Repo } from "./agents-table.ts";
import {
  loadAgentsTable,
  missingEnforcers,
  principleRows,
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
      { enforcers: ["verify"], principle: "1" },
      { enforcers: ["a|b", "gen:check"], principle: "2" },
    ]);
  });
});

// Vitest registers every test before it runs one, and a test per row needs the
// rows then, so AGENTS.md and the repo are read once, here.
const { repo, rows } = await loadAgentsTable();

describe("AGENTS.md's principles table", () => {
  it("is under ## Principles, with a Held by column", () => {
    expect(rows).not.toHaveLength(0);
  });

  it.each(rows)(
    "principle $principle names only enforcers the repo has",
    (row) => {
      expect(missingEnforcers(row, repo)).toStrictEqual([]);
    }
  );
});
