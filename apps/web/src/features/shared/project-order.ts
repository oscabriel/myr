/**
 * Which projects a short list names: the rail's and the
 * landing's. The ones with the most open asks lead, a tie by name, so a
 * reader meets first the projects with work to take. The platform's own
 * list keeps its order; this is the web's.
 */
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Array as Arr, Order } from "effect";

/** The most open asks first, then by name. */
const leading = Order.combine(
  Order.mapInput(
    Order.flip(Order.Number),
    ({ openAsks }: ProjectListing) => openAsks
  ),
  Order.mapInput(Order.String, ({ project }: ProjectListing) => project)
);

/** The `n` projects that lead: the most open asks first, a tie by name. */
export const leadingProjects = (
  projects: readonly ProjectListing[],
  n: number
): readonly ProjectListing[] => Arr.take(Arr.sort(projects, leading), n);
