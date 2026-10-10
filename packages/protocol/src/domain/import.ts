import { Schema } from "effect";

/**
 * Where an imported project came from: the public repo's https address,
 * and the branch its `main` was adopted from when the import named one.
 * The same shape `initProject` takes, kept on the project's record and
 * shown on its page (ADR 0031).
 */
export const ImportSource = Schema.Struct({
  branch: Schema.optionalKey(Schema.NonEmptyString),
  url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/u)),
});

export type ImportSource = typeof ImportSource.Type;
