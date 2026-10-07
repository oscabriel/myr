import { Schema } from "effect";

import {
  AskId,
  CommitSha,
  Handle,
  ProjectName,
  RepoName,
  SuiteRoot,
} from "../ids.ts";

/**
 * Where a claim stands. A live claim is warned after a quiet spell and
 * lapses after a longer one; only a push keeps it alive.
 */
export const ClaimState = Schema.Literals([
  "live",
  "warned",
  "lapsed",
  "released",
  "answered",
]);

export type ClaimState = typeof ClaimState.Type;

/**
 * A claim, as its claimant sees it: one person's exclusive, expiring right to
 * answer an ask, with the fork to push to and when it lapses.
 */
export const ClaimView = Schema.Struct({
  ask: AskId,
  /** Main's landed commit when the claim was made. */
  base: CommitSha,
  /** What `<cli> check` runs locally for this ask. */
  checkCommand: Schema.NonEmptyString,
  claimant: Handle,
  /** The claim's fork: `<project>--<ask>--<handle in lowercase>`. */
  fork: RepoName,
  lapsesAt: Schema.DateTimeUtcFromString,
  lastPushAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  openedAt: Schema.DateTimeUtcFromString,
  project: ProjectName,
  /** The fork's URL at the gateway; never a storage URL. */
  remote: Schema.NonEmptyString,
  state: ClaimState,
  /** The held-back suite pinned when the claim was made. */
  suite: Schema.optionalKey(SuiteRoot),
  warnsAt: Schema.DateTimeUtcFromString,
});

export type ClaimView = typeof ClaimView.Type;
