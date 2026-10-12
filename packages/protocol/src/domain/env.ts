import { Schema } from "effect";

import { EnvKey, Handle, LandedSha, ProjectName, RepoPath } from "../ids.ts";

export const EnvItem = Schema.Struct({
  deprecated: Schema.optionalKey(Schema.Boolean),
  description: Schema.optionalKey(Schema.String),
  docs: Schema.optionalKey(Schema.String),
  key: EnvKey,
  placeholder: Schema.optionalKey(Schema.String),
  proxy: Schema.optionalKey(
    Schema.Struct({
      block: Schema.optionalKey(Schema.Boolean),
      domains: Schema.NonEmptyArray(Schema.NonEmptyString),
      method: Schema.optionalKey(Schema.String),
      path: Schema.optionalKey(Schema.String),
    })
  ),
  required: Schema.Union([Schema.Boolean, Schema.Literal("depends")]),
  sensitive: Schema.Boolean,
  tags: Schema.Array(Schema.NonEmptyString),
  type: Schema.optionalKey(Schema.NonEmptyString),
  value: Schema.optionalKey(
    Schema.Struct({ setAt: Schema.DateTimeUtcFromString, setBy: Handle })
  ),
});

export type EnvItem = typeof EnvItem.Type;

// Named for the file: lint keeps "shape" out of code names.
export const EnvSchemaView = Schema.Struct({
  at: LandedSha,
  currentEnvKey: Schema.optionalKey(EnvKey),
  file: RepoPath,
  imports: Schema.Array(Schema.String),
  items: Schema.Array(EnvItem),
  project: ProjectName,
});

export type EnvSchemaView = typeof EnvSchemaView.Type;
