import { Schema } from "effect";

import {
  AskId,
  CommitSha,
  Handle,
  ProjectName,
  RepoName,
  SuiteRoot,
} from "../ids.ts";

export const ClaimState = Schema.Literals([
  "live",
  "warned",
  "lapsed",
  "released",
  "answered",
]);

export type ClaimState = typeof ClaimState.Type;

export const ClaimView = Schema.Struct({
  ask: AskId,
  base: CommitSha,
  checkCommand: Schema.NonEmptyString,
  claimant: Handle,
  fork: RepoName,
  lapsesAt: Schema.DateTimeUtcFromString,
  lastPushAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  openedAt: Schema.DateTimeUtcFromString,
  project: ProjectName,
  /** The fork's URL at the gateway; never a storage URL. */
  remote: Schema.NonEmptyString,
  state: ClaimState,
  suite: Schema.optionalKey(SuiteRoot),
  warnsAt: Schema.DateTimeUtcFromString,
});

export type ClaimView = typeof ClaimView.Type;
