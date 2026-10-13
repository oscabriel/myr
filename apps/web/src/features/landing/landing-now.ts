/**
 * The landing's "landing now": the latest landings and refused answers across
 * public projects, the latest first, from the platform's one list of them.
 */
import { RecentLanding } from "@repo/protocol/domain/recent-landing";
import { Schema } from "effect";

/** At most this many rows. */
export const LANDINGS_SHOWN = 6;

export const LandingNow = Schema.TaggedUnion({
  Listed: {
    landings: Schema.Array(RecentLanding),
    now: Schema.DateTimeUtcFromString,
  },
  Unreachable: {},
});

export type LandingNow = typeof LandingNow.Type;
