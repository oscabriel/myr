/**
 * The landing's "landing now": the public projects by their last landing,
 * the latest first. Until a read of landings across projects exists (issue
 * 13), a project's last landing stands for its landings.
 */
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Array as Arr, DateTime, Order, Schema } from "effect";

/** At most this many rows. */
export const LANDINGS_SHOWN = 6;

export const LandingNow = Schema.TaggedUnion({
  Listed: {
    now: Schema.DateTimeUtcFromString,
    projects: Schema.Array(ProjectListing),
  },
  Unreachable: {},
});

export type LandingNow = typeof LandingNow.Type;

const latestFirst = Order.flip(DateTime.Order);

/** The projects that have landed, the latest landing first, the first `LANDINGS_SHOWN` of them. */
export const landedLatest = (
  projects: readonly ProjectListing[]
): readonly (ProjectListing & { readonly landedAt: DateTime.Utc })[] =>
  Arr.take(
    Arr.sort(
      Arr.flatMap(projects, ({ landedAt, ...listing }) =>
        landedAt === undefined ? [] : [{ ...listing, landedAt }]
      ),
      Order.mapInput(
        latestFirst,
        ({ landedAt }: { readonly landedAt: DateTime.Utc }) => landedAt
      )
    ),
    LANDINGS_SHOWN
  );
