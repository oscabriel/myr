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

/**
 * An ask's brief: what an answerer reads first. The want is behavioural; it
 * names no file and no line.
 */
export const Brief = Schema.Struct({
  context: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  /** What happens on main today. */
  current: Schema.optionalKey(Schema.NonEmptyString),
  outOfScope: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  /** Words the ask uses in its project's sense. */
  terms: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  want: Schema.NonEmptyString,
});

export type Brief = typeof Brief.Type;

/** Where an ask stands: open, claimed, waiting on its parent, or closed. */
export const AskState = Schema.Literals([
  "open",
  "claimed",
  "waitingOnParent",
  "closed",
]);

export type AskState = typeof AskState.Type;

/** Who an ask is held for, when it is held for someone: `newcomers` (with a mentor) or `people`. */
export const Reserve = Schema.Literals(["newcomers", "people"]);

export type Reserve = typeof Reserve.Type;

/**
 * An ask: a file on main in which a project states one change it wants, with
 * a behavioural want, a territory, and a check that fails on main.
 */
export const Ask = Schema.Struct({
  askedBy: Handle,
  /** Asks that must land first, as a migrate's last step waits on its siblings. */
  blockedBy: Schema.Array(AskId),
  brief: Brief,
  check: CheckSpec,
  /** The ask's file on main, in the config folder's `asks/`. */
  file: RepoPath,
  id: AskId,
  kind: KindName,
  mentor: Schema.optionalKey(Handle),
  openedAt: Schema.DateTimeUtcFromString,
  /** The landing that opened it. */
  openedIn: LandedSha,
  /** The migrate ask this one is a step of. */
  parent: Schema.optionalKey(AskId),
  project: ProjectName,
  reserve: Schema.optionalKey(Reserve),
  state: AskState,
  territory: Territory,
});

export type Ask = typeof Ask.Type;

/** One open ask, as a list of asks shows it. */
export const AskListing = Schema.Struct({
  ask: AskId,
  blockedBy: Schema.Array(AskId),
  claimed: Schema.Boolean,
  kind: KindName,
  reserve: Schema.optionalKey(Reserve),
  /** The territory's module. */
  territory: Schema.NonEmptyString,
  want: Schema.NonEmptyString,
});

export type AskListing = typeof AskListing.Type;
