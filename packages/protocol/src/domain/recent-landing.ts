/**
 * The latest landings across public projects, and the latest refusals of
 * answers, as the landing's "landing now" lists them. Every field is a public
 * fact: a refusal is shown by its tag and the area it names, never by a
 * check's name, a suite, a path or a log.
 */
import { Schema } from "effect";

import { AskId, LandedSha, ProjectName } from "../ids.ts";
import { Refusal } from "../refusal.ts";

/** The read keeps and lists at most this many rows. */
export const RECENT_LANDINGS_CAP = 20;

const refusalTags: ReadonlySet<string> = new Set(
  Refusal.members.map(({ identifier }) => identifier)
);

const isRefusalTag = (tag: string): tag is Refusal["_tag"] =>
  refusalTags.has(tag);

/** One tag of the closed refusal union. */
export const RefusalTag = Schema.NonEmptyString.pipe(
  Schema.refine(isRefusalTag, { expected: "a refusal's tag" })
);

/** A refusal as a public list shows it: its tag, and its area when it names one. */
export const ShownRefusal = Schema.Struct({
  area: Schema.optionalKey(Schema.NonEmptyString),
  tag: RefusalTag,
});

export type ShownRefusal = typeof ShownRefusal.Type;

/** What a public list may say of a refusal, and nothing more. */
export const shownRefusal = (refusal: Refusal): ShownRefusal =>
  "area" in refusal
    ? { area: refusal.area, tag: refusal._tag }
    : { tag: refusal._tag };

export const RecentLanding = Schema.TaggedUnion({
  /** A landing on a project's main: the ask it answered or opened, and that ask's want when the list knew it. */
  Landed: {
    answered: Schema.optionalKey(AskId),
    at: Schema.DateTimeUtcFromString,
    opened: Schema.optionalKey(AskId),
    project: ProjectName,
    sha: LandedSha,
    want: Schema.optionalKey(Schema.NonEmptyString),
  },
  /** An answer the gate refused: the ask it answered, and why, by tag and area. */
  Refused: {
    ask: AskId,
    at: Schema.DateTimeUtcFromString,
    project: ProjectName,
    refusals: Schema.NonEmptyArray(ShownRefusal),
    want: Schema.optionalKey(Schema.NonEmptyString),
  },
});

export type RecentLanding = typeof RecentLanding.Type;

/** The latest first, at most `RECENT_LANDINGS_CAP` of them. */
export const RecentLandings = Schema.Array(RecentLanding).check(
  Schema.isMaxLength(RECENT_LANDINGS_CAP)
);
