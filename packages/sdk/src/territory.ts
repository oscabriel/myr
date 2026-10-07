/**
 * Builders for an ask's territory, the module an answer may change, and for
 * where a project's modules come from.
 */
import { Territory } from "@repo/protocol/domain/territory";
import { Schema } from "effect";

import { checked } from "./checked.ts";

/** An ask's territory as the config folder states it: a module and its paths, as plain data. */
export type TerritoryInput = typeof Territory.Encoded;

/**
 * The placeholder a package territory's paths hold until the rules evaluator
 * writes the package's folder in from the workspaces it is told about, as a
 * run block's `{path}` waits for its file. Unfilled, it names no real
 * folder, so an answer is refused rather than let through.
 */
export const packageDir = "{dir}";

/** Where a project's modules come from: its workspace packages, one module each. */
export const FromWorkspaces = Schema.TaggedStruct("FromWorkspaces", {});

/** Where a project's modules come from, as plain data. */
export type ModulesInput = typeof FromWorkspaces.Encoded;

const territoryOf = checked(Territory);

/** The builders for a territory, and for a project's modules. */
export const territory = {
  /**
   * Each workspace package is a module, and its `package.json` `exports` are
   * its public files. This is the only source of modules, and the default.
   */
  fromWorkspaces: (): ModulesInput => FromWorkspaces.make({}),
  /**
   * One workspace package, by its name: an answer may change any path in its
   * folder (`{dir}/**` until the evaluator fills the folder in).
   */
  package: (name: string): TerritoryInput =>
    territoryOf({ module: name, paths: [`${packageDir}/**`] }),
  /**
   * The escape hatch: exactly these globs, in a repo-wide module (`.`).
   * `territory.paths("src/parse.ts", "test/parse.test.ts")`.
   */
  paths: (...globs: readonly [string, ...string[]]): TerritoryInput =>
    territoryOf({ module: ".", paths: globs }),
};
