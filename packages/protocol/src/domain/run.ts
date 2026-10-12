import { Schema } from "effect";

import { LaneName } from "../ids.ts";
import { Command, Hostname } from "./common.ts";

export const RunBlock = Schema.Struct({
  checks: Schema.Record(LaneName, Command),
  doctor: Schema.optionalKey(Command),
  image: Schema.optionalKey(Schema.NonEmptyString),
  setup: Schema.optionalKey(Command),
  /** Hosts setup may reach beyond the defaults; setup only, never the checks. */
  setupEgress: Schema.optionalKey(Schema.Array(Hostname)),
  test: Command,
});

export type RunBlock = typeof RunBlock.Type;
