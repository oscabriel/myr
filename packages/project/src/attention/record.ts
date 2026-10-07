/**
 * A person's record (GLOSSARY "Record"): their landings by area that stayed
 * unreverted long enough to count, inside the window that still counts. It
 * answers trust rules only, yes or no: it is never a score, never a ranking,
 * and never leaves `packages/project` (spec §2.3). Nothing here counts
 * against anyone: a check that flaked or a verifier that was blocked never
 * reached a landing, so it is not in the record at all.
 *
 * Pure: `now` and which landings were reverted are arguments. The project
 * service builds `reverted` from revert landings and `StrayPush` decisions
 * decided `revert`, since a landing does not say it was reverted.
 */
import type { Ask } from "@repo/protocol/domain/ask";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { Policy } from "@repo/protocol/domain/policy";
import type { AskId, Handle, LandedSha, ProjectName } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Option } from "effect";

/** One landing that counts on its accountable person's record, in its area. */
export interface RecordEntry {
  /** The module of the territory its ask was in. */
  readonly area: string;
  /** When it landed. */
  readonly at: DateTime.Utc;
  readonly handle: Handle;
  readonly landing: LandedSha;
  readonly project: ProjectName;
}

/** What a record is built from. */
export interface RecordInput {
  /**
   * The project's asks by id, closed ones included, to find each landing's
   * area. Ask ids are unique only within a project, so give one project's
   * asks and landings, and build one record per project for several: a
   * landing whose id finds another project's ask counts for no area.
   */
  readonly asks: ReadonlyMap<AskId, Ask>;
  readonly landings: readonly LandingView[];
  readonly now: DateTime.Utc;
  readonly policy: Policy["record"];
  /** Landings since reverted; they never count. */
  readonly reverted: ReadonlySet<LandedSha>;
}

/** A record rule: at least `atLeast` counted landings in `area`. */
export interface RecordRule {
  readonly area: string;
  readonly atLeast: number;
}

/** A handle as a map key: the form `sameHandle` (`@repo/protocol/ids`) compares by. */
const personOf = (handle: Handle) => handle.toLowerCase();

/**
 * A landing's area: the module of the territory its ask was in. A landing
 * that answered no ask (a decider's own, the first adoption), or whose ask
 * is not known in its project, has none.
 */
export const areaOf = (
  landing: LandingView,
  asks: ReadonlyMap<AskId, Ask>
): Option.Option<string> =>
  Option.fromUndefinedOr(landing.ask).pipe(
    Option.flatMap((id) => Option.fromUndefinedOr(asks.get(id))),
    Option.filter((ask) => ask.project === landing.project),
    Option.map((ask) => ask.territory.module)
  );

/**
 * Whether a landing counts at `now`: it has stayed for `countsAfterDays`
 * (from that day on) and is no older than `windowDays` (that day included).
 */
const counts = (
  landedAt: DateTime.Utc,
  now: DateTime.Utc,
  window: Policy["record"]
) =>
  DateTime.isLessThanOrEqualTo(
    DateTime.add(landedAt, { days: window.countsAfterDays }),
    now
  ) &&
  DateTime.isLessThanOrEqualTo(
    now,
    DateTime.add(landedAt, { days: window.windowDays })
  );

/**
 * Everyone's record at `now`, built once; the result looks up one person's.
 * A landing is on the record of its author, the accountable person, and
 * counts after `countsAfterDays` unreverted, for `windowDays`. Entries keep
 * the landings' order.
 */
export const recordOf = (
  input: RecordInput
): ((handle: Handle) => readonly RecordEntry[]) => {
  const entries = Arr.flatMap(input.landings, (landing): RecordEntry[] => {
    if (
      input.reverted.has(landing.sha) ||
      !counts(landing.landedAt, input.now, input.policy)
    ) {
      return [];
    }

    return Option.match(areaOf(landing, input.asks), {
      onNone: () => [],
      onSome: (area) => [
        {
          area,
          at: landing.landedAt,
          handle: landing.author,
          landing: landing.sha,
          project: landing.project,
        },
      ],
    });
  });

  // A Map, not a record: `constructor` is a valid handle.
  const byPerson = new Map<string, RecordEntry[]>();

  for (const entry of entries) {
    const held = byPerson.get(personOf(entry.handle));

    if (held === undefined) {
      byPerson.set(personOf(entry.handle), [entry]);
    } else {
      held.push(entry);
    }
  }

  return (handle) => byPerson.get(personOf(handle)) ?? [];
};

/**
 * Whether a record holds at least `atLeast` counted landings in `area`: yes
 * or no, never how many. It counts every entry it is given, so a caller
 * holding several projects' entries passes one project's (`mayClaim` does).
 */
export const meets = (
  entries: readonly RecordEntry[],
  rule: RecordRule
): boolean =>
  Arr.countBy(entries, ({ area }) => area === rule.area) >= rule.atLeast;
