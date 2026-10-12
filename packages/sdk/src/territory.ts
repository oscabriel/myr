import { Territory } from "@repo/protocol/domain/territory";
import { Schema } from "effect";

import { checked } from "./checked.ts";

export type TerritoryInput = typeof Territory.Encoded;

/**
 * Filled in by the rules evaluator from the workspaces. Unfilled, it names no
 * real folder, so an answer is refused rather than let through.
 */
export const packageDir = "{dir}";

export const FromWorkspaces = Schema.TaggedStruct("FromWorkspaces", {});

export type ModulesInput = typeof FromWorkspaces.Encoded;

const territoryOf = checked(Territory);

export const territory = {
  /** Each workspace package is a module, its `exports` its public files. The default. */
  fromWorkspaces: (): ModulesInput => FromWorkspaces.make({}),
  /** One workspace package, by its name: an answer may change any path in its folder. */
  package: (name: string): TerritoryInput =>
    territoryOf({ module: name, paths: [`${packageDir}/**`] }),
  /**
   * The escape hatch: exactly these globs, in a repo-wide module (`.`).
   * `territory.paths("src/parse.ts", "test/parse.test.ts")`.
   */
  paths: (...globs: readonly [string, ...string[]]): TerritoryInput =>
    territoryOf({ module: ".", paths: globs }),
};
