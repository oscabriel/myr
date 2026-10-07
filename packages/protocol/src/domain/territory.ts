import { Schema } from "effect";

import { RepoPath } from "../ids.ts";
import { Glob } from "./common.ts";

/**
 * The module an answer may change: by default one workspace package, its
 * paths derived from the package's folder. Globs are the escape hatch.
 */
export const Territory = Schema.Struct({
  /** The workspace package's name, or `.` for a single-package repo. */
  module: Schema.NonEmptyString,
  paths: Schema.NonEmptyArray(Glob),
  /** The files the module exports, so an import of anything else reaches its internals. */
  publicFiles: Schema.optionalKey(Schema.Array(RepoPath)),
});

export type Territory = typeof Territory.Type;
