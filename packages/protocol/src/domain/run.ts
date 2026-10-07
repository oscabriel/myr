import { Schema } from "effect";

import { LaneName } from "../ids.ts";
import { Command, Hostname } from "./common.ts";

/**
 * The run block: the project's own commands, which the platform runs to
 * check an answer exactly as a contributor runs them at home.
 */
export const RunBlock = Schema.Struct({
  /** Each lane's command, by lane: `{ lint: "bun run lint", unit: "bun run test" }`. */
  checks: Schema.Record(LaneName, Command),
  doctor: Schema.optionalKey(Command),
  /** The checker image to run in; `checker:default` when absent. */
  image: Schema.optionalKey(Schema.NonEmptyString),
  /** Installs what the checks need, once, before the network closes. */
  setup: Schema.optionalKey(Command),
  /** Hosts setup may reach beyond the defaults; setup only, never the checks. */
  setupEgress: Schema.optionalKey(Schema.Array(Hostname)),
  /** Runs one check file, named by its `{path}` placeholder. */
  test: Command,
});

export type RunBlock = typeof RunBlock.Type;
