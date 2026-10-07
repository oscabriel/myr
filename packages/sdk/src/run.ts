/**
 * The run block: the project's own commands, written out or found from CI.
 */
import { FromCI } from "@repo/protocol/domain/policy";
import type { RunBlock } from "@repo/protocol/domain/run";

/** A test command, which names the one check file it runs with `{path}`: `bun test {path}`. */
export type TestCommand = `${string}{path}${string}`;

/**
 * A run block written out: `setup` once before the network closes, `test`
 * for one check file, and each lane's command in `checks`, by lane.
 */
export type RunBlockInput = Omit<typeof RunBlock.Encoded, "test"> & {
  readonly test: TestCommand;
};

/** A project's run block: written out, or `run.fromCI`. */
export type RunInput = RunBlockInput | typeof FromCI.Encoded;

/** Where a project's run block comes from. */
export const run = {
  /**
   * The run block the platform finds in the project's own scripts and CI
   * files, shown to the initializer to confirm. The default.
   */
  fromCI: FromCI.make({}),
};
