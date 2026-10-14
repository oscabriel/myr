import type { RepoHost } from "@repo/artifacts/repo-host";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { ProjectName } from "@repo/protocol/ids";
import { Array as Arr, Effect } from "effect";

import { withDescriptions } from "./description.ts";
import type { LandedProject } from "./description.ts";
import type { Projects } from "./projects.ts";
import { withStandingPosture } from "./standing-posture.ts";

/**
 * A listing with each project's own posture and its description: two reads,
 * each of its own kept record and then of the projects it finds stale, made
 * at once, since neither waits on the other's answer.
 */
export const withProjectFacts = <E>(
  listed: readonly ProjectListing[],
  landedOf: (project: ProjectName) => Effect.Effect<LandedProject, E>
): Effect.Effect<readonly ProjectListing[], never, Projects | RepoHost> =>
  Effect.map(
    Effect.all(
      [withStandingPosture(listed), withDescriptions(listed, landedOf)],
      { concurrency: 2 }
    ),
    ([postured, described]) =>
      Arr.zipWith(described, postured, (listing, { posture }) => ({
        ...listing,
        posture,
      }))
  );
