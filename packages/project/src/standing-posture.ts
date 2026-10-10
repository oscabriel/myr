/**
 * A listed project's posture, as its own record says it now. The
 * projection's `posture` moves only on a `PostureChanged` ledger entry, and
 * a project's standing changes without one: its first config stands at
 * once, a widening needs no decision, and an accepted narrowing takes
 * effect when its notice runs out, by the clock. So a list of projects
 * reads from each one's own record the posture its ledger shows now
 * (`ProjectApi.standing`, the value the ledger's `posture` is), and shows
 * that: the badge and the ledger are one value, read at the source.
 *
 * What was read is kept (`StandingPostures`) with the next instant the
 * posture moves by the clock alone (an accepted narrowing's notice running
 * out) and the project's last event the read saw. A kept posture serves
 * until that instant; an event that can move it sooner (a landing, a
 * decision, a ledger entry) clears it where the projection applies that
 * event (`projection-d1/projection.ts`), and a store that applied a later
 * event than the read saw keeps nothing from it. A store that fails is a
 * miss, never the list's failure.
 *
 * Cost: one read per listed project whose kept posture is missing or ran
 * out, at most 8 at once; none for the rest.
 */
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Array as Arr, Cause, Context, DateTime, Effect, Option } from "effect";

import { Projects } from "./projects.ts";

/** A project's standing posture as it is kept between lists. */
export interface StandingEntry {
  readonly posture: Posture;
  /** The instant it moves by the clock alone; none when only an event moves it. */
  readonly until?: DateTime.Utc;
  /**
   * The project's last event the read saw: a store that has applied a
   * later event of the project keeps nothing from it, since that event may
   * have moved the posture after the read.
   */
  readonly seen: number;
}

/** Where a list keeps each project's standing posture between lists. */
export interface StandingPosturesApi {
  /** What is kept for each of `projects`; a store that fails keeps nothing. */
  readonly get: (
    projects: readonly ProjectName[]
  ) => Effect.Effect<ReadonlyMap<ProjectName, StandingEntry>>;
  /** Keeps `entries`; a store that fails keeps nothing, silently to the caller. */
  readonly put: (
    entries: ReadonlyMap<ProjectName, StandingEntry>
  ) => Effect.Effect<void>;
}

/**
 * The kept standing postures: a `Context.Reference` whose default keeps
 * nothing, so every list reads each project, as every host did before one
 * was given; the platform gives one over D1 (`projection-d1/postures.ts`).
 */
export const StandingPostures = Context.Reference<StandingPosturesApi>(
  "project/StandingPostures",
  {
    defaultValue: () => ({
      get: () => Effect.succeed(new Map()),
      put: () => Effect.void,
    }),
  }
);

/** How many projects a list reads at once (the platform handlers' `FAN_OUT`). */
const READS_AT_ONCE = 8;

/** `effect`, or `fallback` with a warning if it fails: an interruption stays one. */
const orWarn = <A, E>(
  effect: Effect.Effect<A, E>,
  fallback: A,
  warning: string
): Effect.Effect<A> =>
  Effect.catchCause(effect, (cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.interrupt
      : Effect.as(Effect.logWarning(warning, cause), fallback)
  );

/**
 * `listed` with each project's posture as its own record says it now (the
 * posture its ledger shows): what `StandingPostures` keeps for it while
 * that has not run out, else read from the project, at most 8 at once, and
 * kept with the instant it moves by the clock. A project never made, or
 * one whose read fails, keeps the posture the projection listed and is not
 * kept; a store that fails is a miss.
 */
export const withStandingPosture = (
  listed: readonly ProjectListing[]
): Effect.Effect<readonly ProjectListing[], never, Projects> =>
  Effect.gen(function* () {
    if (listed.length === 0) {
      return listed;
    }

    const projects = yield* Projects;
    const store = yield* StandingPostures;
    const now = yield* DateTime.now;
    const names = Arr.dedupe(listed.map(({ project }) => project));

    const kept = yield* orWarn(
      Effect.suspend(() => store.get(names)),
      new Map<ProjectName, StandingEntry>(),
      "the kept standing postures were not read: every project is read"
    );

    const fresh = new Map(
      [...kept].filter(
        ([, { until }]) =>
          until === undefined || DateTime.isLessThan(now, until)
      )
    );

    const read = yield* Effect.forEach(
      names.filter((project) => !fresh.has(project)),
      (project) =>
        orWarn(
          Effect.suspend(() => projects.get(project)).pipe(
            Effect.flatMap((api) => api.standing()),
            Effect.map(({ posture, seen, until }) =>
              Option.some([
                project,
                until === undefined
                  ? { posture, seen }
                  : { posture, seen, until },
              ] as const)
            )
          ),
          Option.none(),
          `${project}'s posture is the projection's: its ledger was not read`
        ),
      { concurrency: READS_AT_ONCE }
    );

    const found = new Map<ProjectName, StandingEntry>(Arr.getSomes(read));

    if (found.size > 0) {
      yield* orWarn(
        Effect.suspend(() => store.put(found)),
        undefined,
        "the standing postures read were not kept"
      );
    }

    return listed.map((listing): ProjectListing => {
      const entry = found.get(listing.project) ?? fresh.get(listing.project);

      return entry === undefined
        ? listing
        : { ...listing, posture: entry.posture };
    });
  });
