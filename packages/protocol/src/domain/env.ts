import { Schema } from "effect";

import { EnvKey, Handle, LandedSha, ProjectName, RepoPath } from "../ids.ts";

/**
 * One item of a project's env shape, as its `.env.schema` declares it. A
 * write-only value's item says who set it and when, never the value.
 */
export const EnvItem = Schema.Struct({
  deprecated: Schema.optionalKey(Schema.Boolean),
  description: Schema.optionalKey(Schema.String),
  docs: Schema.optionalKey(Schema.String),
  key: EnvKey,
  /** What unlanded code sees in place of a write-only value. */
  placeholder: Schema.optionalKey(Schema.String),
  /** The outbound requests on which the platform swaps the placeholder for the value. */
  proxy: Schema.optionalKey(
    Schema.Struct({
      block: Schema.optionalKey(Schema.Boolean),
      domains: Schema.NonEmptyArray(Schema.NonEmptyString),
      method: Schema.optionalKey(Schema.String),
      path: Schema.optionalKey(Schema.String),
    })
  ),
  /** `depends` when the schema decides it with a function. */
  required: Schema.Union([Schema.Boolean, Schema.Literal("depends")]),
  /** A flag set by a function counts as sensitive. */
  sensitive: Schema.Boolean,
  tags: Schema.Array(Schema.NonEmptyString),
  /** The `@type` text, shown and never run. */
  type: Schema.optionalKey(Schema.NonEmptyString),
  value: Schema.optionalKey(
    Schema.Struct({ setAt: Schema.DateTimeUtcFromString, setBy: Handle })
  ),
});

export type EnvItem = typeof EnvItem.Type;

/**
 * A project's env shape: the public schema of its environment variables,
 * parsed from its committed `.env.schema` at a landed commit and never
 * resolved. (Named for the file: lint keeps "shape" out of code names.)
 */
export const EnvSchemaView = Schema.Struct({
  at: LandedSha,
  currentEnvKey: Schema.optionalKey(EnvKey),
  file: RepoPath,
  imports: Schema.Array(Schema.String),
  items: Schema.Array(EnvItem),
  project: ProjectName,
});

export type EnvSchemaView = typeof EnvSchemaView.Type;
