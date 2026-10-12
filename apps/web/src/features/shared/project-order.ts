import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Array as Arr, Order } from "effect";

export const PROJECTS_SHOWN = 8;

const leading = Order.combine(
  Order.mapInput(
    Order.flip(Order.Number),
    ({ openAsks }: ProjectListing) => openAsks
  ),
  Order.mapInput(Order.String, ({ project }: ProjectListing) => project)
);

export const leadingProjects = (
  projects: readonly ProjectListing[],
  n: number
): readonly ProjectListing[] => Arr.take(Arr.sort(projects, leading), n);
