import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Array as Arr, Cause, Context, DateTime, Effect, Option } from "effect";

import { Projects } from "./projects.ts";

export interface StandingEntry {
  readonly posture: Posture;
  readonly until?: DateTime.Utc;
  /**
   * A store that applied a later event of the project keeps nothing from this
   * read.
   */
  readonly seen: number;
}

export interface StandingPosturesApi {
  readonly get: (
    projects: readonly ProjectName[]
  ) => Effect.Effect<ReadonlyMap<ProjectName, StandingEntry>>;
  readonly put: (
    entries: ReadonlyMap<ProjectName, StandingEntry>
  ) => Effect.Effect<void>;
}

/** The default keeps nothing, so every list reads each project. */
export const StandingPostures = Context.Reference<StandingPosturesApi>(
  "project/StandingPostures",
  {
    defaultValue: () => ({
      get: () => Effect.succeed(new Map()),
      put: () => Effect.void,
    }),
  }
);

const READS_AT_ONCE = 8;

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
 * The projection's posture moves only on a `PostureChanged` entry, but a
 * standing posture also moves by the clock and without a decision, so a list
 * reads each project's own record.
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
