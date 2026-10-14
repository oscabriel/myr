/**
 * Whether the platform has anything live to point the tour at: an open ask,
 * a landing. Read as nobody, so the page stays one the edge may keep.
 */
import { Client } from "@repo/protocol/contracts";
import { Effect } from "effect";

export interface TourLive {
  readonly asks: boolean;
  readonly landings: boolean;
}

const some = <A, E>(
  read: Effect.Effect<readonly A[], E, Client>
): Effect.Effect<boolean, never, Client> =>
  read.pipe(
    Effect.map((items) => items.length > 0),
    Effect.catchCause(() => Effect.succeed(false))
  );

export const readTourLive: Effect.Effect<TourLive, never, Client> = Effect.gen(
  function* () {
    const client = yield* Client;

    const [asks, landings] = yield* Effect.all(
      [
        some(Effect.map(client.frontPage({}), ({ entries }) => entries)),
        some(
          Effect.map(client.recentLandings({}), ({ landings: rows }) => rows)
        ),
      ],
      { concurrency: "unbounded" }
    );

    return { asks, landings };
  }
);
