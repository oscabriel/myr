import type { Ask } from "@repo/protocol/domain/ask";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { Policy } from "@repo/protocol/domain/policy";
import type { AskId, Handle, LandedSha, ProjectName } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Option } from "effect";

export interface RecordEntry {
  readonly area: string;
  readonly at: DateTime.Utc;
  readonly handle: Handle;
  readonly landing: LandedSha;
  readonly project: ProjectName;
}

export interface RecordInput {
  /** Ask ids are unique only within a project: give one project's asks and landings. */
  readonly asks: ReadonlyMap<AskId, Ask>;
  readonly landings: readonly LandingView[];
  readonly now: DateTime.Utc;
  readonly policy: Policy["record"];
  readonly reverted: ReadonlySet<LandedSha>;
}

export interface RecordRule {
  readonly area: string;
  readonly atLeast: number;
}

const personOf = (handle: Handle) => handle.toLowerCase();

export const areaOf = (
  landing: LandingView,
  asks: ReadonlyMap<AskId, Ask>
): Option.Option<string> =>
  Option.fromUndefinedOr(landing.ask).pipe(
    Option.flatMap((id) => Option.fromUndefinedOr(asks.get(id))),
    Option.filter((ask) => ask.project === landing.project),
    Option.map((ask) => ask.territory.module)
  );

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

/** Counts every entry it is given: pass one project's entries. */
export const meets = (
  entries: readonly RecordEntry[],
  rule: RecordRule
): boolean =>
  Arr.countBy(entries, ({ area }) => area === rule.area) >= rule.atLeast;
