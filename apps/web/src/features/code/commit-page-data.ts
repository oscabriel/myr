import { CommitDiff } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { Schema } from "effect";

export const CommitPageData = Schema.Struct({
  diff: CommitDiff,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  territory: Schema.optionalKey(Schema.Array(Schema.String)),
});
