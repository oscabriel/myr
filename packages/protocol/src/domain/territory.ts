import { Schema } from "effect";

import { RepoPath } from "../ids.ts";
import { Glob } from "./common.ts";

export const Territory = Schema.Struct({
  module: Schema.NonEmptyString,
  paths: Schema.NonEmptyArray(Glob),
  publicFiles: Schema.optionalKey(Schema.Array(RepoPath)),
});

export type Territory = typeof Territory.Type;
