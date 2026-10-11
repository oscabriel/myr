/**
 * A commit page's data, as its loader sends it: the rail reads the files
 * it changed from the page's match (`-rail-body.tsx`), so the rail's tree
 * and the page's diff come from one read. Not a route: the `-` prefix
 * keeps the router from reading it as one.
 */
import { CommitDiff } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { Schema } from "effect";

export const CommitPageData = Schema.Struct({
  diff: CommitDiff,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  /** The territory of the ask the commit answered, when it answered one. */
  territory: Schema.optionalKey(Schema.Array(Schema.String)),
});
