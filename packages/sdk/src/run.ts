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

export type RunInput = RunBlockInput | typeof FromCI.Encoded;

export const run = {
  /** The run block the platform finds in the project's scripts and CI, for the initializer to confirm. The default. */
  fromCI: FromCI.make({}),
};
