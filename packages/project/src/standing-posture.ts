/**
 * A listed project's posture, as its own record says it now. The
 * projection's `posture` moves only on a `PostureChanged` ledger entry, and
 * a project's standing changes without one: its first config stands at
 * once, a widening needs no decision, and an accepted narrowing takes
 * effect when its notice runs out, by the clock. So a list of projects
 * reads each one's ledger, the public read whose `posture` is the standing
 * at now (`visibility/ledger.ts`), and shows that: the badge and the ledger
 * are one value, read at the source, with nothing written to keep them in
 * step.
 *
 * Cost: one ledger read per listed project per list, at most 8 at once,
 * each read whole for its one `posture` field.
 */
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Anonymous } from "@repo/protocol/principal";
import { Cause, Effect } from "effect";

import { Projects } from "./projects.ts";

/** How many projects a list reads at once (the platform handlers' `FAN_OUT`). */
const READS_AT_ONCE = 8;

/**
 * `listed` with each project's posture as its own record says it now (its
 * ledger's standing), read at most 8 at once; a project never made, or one
 * whose read fails, keeps the posture the projection listed.
 */
export const withStandingPosture = (
  listed: readonly ProjectListing[]
): Effect.Effect<readonly ProjectListing[], never, Projects> =>
  Effect.gen(function* () {
    const projects = yield* Projects;

    return yield* Effect.forEach(
      listed,
      (listing) =>
        Effect.suspend(() => projects.get(listing.project)).pipe(
          Effect.flatMap((api) => api.ledger(Anonymous.make({}))),
          Effect.map(({ posture }): ProjectListing => ({
            ...listing,
            posture,
          })),
          // The list answers whatever one project does, a `get` that
          // throws included: an interruption stays one, and anything else
          // keeps the projected posture.
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.as(
                  Effect.logWarning(
                    `${listing.project}'s posture is the projection's: its ledger was not read`,
                    cause
                  ),
                  listing
                )
          )
        ),
      { concurrency: READS_AT_ONCE }
    );
  });
