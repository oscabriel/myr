/**
 * The rule's own fixture test (`bun run lint:rules`): oxlint's `RuleTester`
 * runs it over `fixtures/`, as code in a package's `src/` and outside it.
 */
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import { noModuleLevelMutableState } from "./rules/no-module-level-mutable-state.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf-8");

const bad = fixture("bad.ts");
const good = fixture("good.ts");

new RuleTester().run(
  "no-module-level-mutable-state",
  noModuleLevelMutableState,
  {
    invalid: [
      {
        code: bad,
        errors: [
          { line: 2, messageId: "moduleState" },
          { line: 4, messageId: "moduleState" },
          { line: 8, messageId: "moduleState" },
        ],
        filename: "packages/kit/src/bad.ts",
        name: "module-level let and var in a package's src/",
      },
    ],
    valid: [
      {
        code: good,
        filename: "packages/kit/src/good.ts",
        name: "const, an ambient let, and bindings inside functions",
      },
      {
        code: bad,
        filename: "packages/kit/test/bad.test.ts",
        name: "a test is not runtime source",
      },
      {
        code: bad,
        filename: "scripts/bad.ts",
        name: "a script outside the packages is not runtime source",
      },
    ],
  }
);
