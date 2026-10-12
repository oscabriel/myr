import { Schema } from "effect";

import {
  AskId,
  Handle,
  KindName,
  LandedSha,
  ProjectName,
  RepoPath,
} from "../ids.ts";
import { CheckSpec } from "./check.ts";
import { Territory } from "./territory.ts";

export const Brief = Schema.Struct({
  context: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  current: Schema.optionalKey(Schema.NonEmptyString),
  outOfScope: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  terms: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  want: Schema.NonEmptyString,
});

export type Brief = typeof Brief.Type;

export const AskState = Schema.Literals([
  "open",
  "claimed",
  "waitingOnParent",
  "closed",
]);

export type AskState = typeof AskState.Type;

export const Reserve = Schema.Literals(["newcomers", "people"]);

export type Reserve = typeof Reserve.Type;

export const Ask = Schema.Struct({
  askedBy: Handle,
  blockedBy: Schema.Array(AskId),
  brief: Brief,
  check: CheckSpec,
  file: RepoPath,
  id: AskId,
  kind: KindName,
  mentor: Schema.optionalKey(Handle),
  openedAt: Schema.DateTimeUtcFromString,
  openedIn: LandedSha,
  parent: Schema.optionalKey(AskId),
  project: ProjectName,
  reserve: Schema.optionalKey(Reserve),
  state: AskState,
  territory: Territory,
});

export type Ask = typeof Ask.Type;

export const AskListing = Schema.Struct({
  ask: AskId,
  blockedBy: Schema.Array(AskId),
  claimed: Schema.Boolean,
  kind: KindName,
  reserve: Schema.optionalKey(Reserve),
  territory: Schema.NonEmptyString,
  want: Schema.NonEmptyString,
});

export type AskListing = typeof AskListing.Type;
