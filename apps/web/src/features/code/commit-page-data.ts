import { CommitDiff, Rev } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { Schema } from "effect";

export const CommitPageData = Schema.Struct({
  /** The fork the commit was read in, by its address. */
  at: Schema.optionalKey(Rev),
  diff: CommitDiff,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  territory: Schema.optionalKey(Schema.Array(Schema.String)),
});
