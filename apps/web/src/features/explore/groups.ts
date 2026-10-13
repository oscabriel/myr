import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Array as Arr, DateTime, Order } from "effect";

export interface ExploreGroups {
  /** Projects with an open ask, so a reader looking for work sees them first. */
  readonly taking: readonly ProjectListing[];
  readonly rest: readonly ProjectListing[];
}

const NEVER = Number.NEGATIVE_INFINITY;

// The latest landing first, a project not yet landed last, a tie by name.
const byLatestLanding = Order.combine(
  Order.mapInput(Order.flip(Order.Number), ({ landedAt }: ProjectListing) =>
    landedAt === undefined ? NEVER : DateTime.toEpochMillis(landedAt)
  ),
  Order.mapInput(Order.String, ({ project }: ProjectListing) => project)
);

export const exploreGroups = (
  projects: readonly ProjectListing[]
): ExploreGroups => {
  const sorted = Arr.sort(projects, byLatestLanding);

  return {
    rest: sorted.filter(({ openAsks }) => openAsks === 0),
    taking: sorted.filter(({ openAsks }) => openAsks > 0),
  };
};
