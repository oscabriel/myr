/**
 * Ratchets' baselines, and the rules that move them (GLOSSARY "Ratchet"):
 * a baseline per (ratchet, territory), recorded at landing and lowered by a
 * landing with no one asking; the only way up is a `RaiseRatchet` decision a
 * decider accepts. Pure: the counts come from `@repo/checks/kinds/ratchet`'s
 * `measure`, an answer's counts are judged against these baselines there
 * (`judgeRatchets`, which `<cli> check` judges with too), and the baselines
 * live in the Project DO's `ratchets` rows (no suppressions file in the
 * tree).
 */
import { sameRatchet } from "@repo/checks/kinds/ratchet";
import type {
  RaiseRatchet,
  RatchetCount,
  RatchetKey,
} from "@repo/checks/kinds/ratchet";
import type { Choice } from "@repo/protocol/domain/decision";
import type { LandedSha, RatchetName } from "@repo/protocol/ids";
import { Array, Option } from "effect";

/** A ratchet's baseline in one territory, and the landed SHA that set it. */
export interface RatchetBaseline {
  readonly ratchet: RatchetName;
  readonly territory: string;
  readonly count: number;
  readonly setAt: LandedSha;
}

/** A baseline a landing lowered, from what to what. */
export interface Lowered {
  readonly ratchet: RatchetName;
  readonly territory: string;
  readonly before: number;
  readonly after: number;
}

/** The baselines after a landing, and the ones it lowered. */
export interface BaselinesAfterLanding {
  readonly baselines: readonly RatchetBaseline[];
  readonly lowered: readonly Lowered[];
}

const baselineOf = (baselines: readonly RatchetBaseline[], key: RatchetKey) =>
  Array.findFirst(baselines, sameRatchet(key));

/**
 * The baselines after a landing measured `measured` at `landed`: each count
 * under its baseline lowers it (and is named in `lowered`), a ratchet with no
 * baseline yet takes its count, and nothing else moves. A landing never
 * raises a baseline: an accepted `RaiseRatchet` already set it.
 */
export const afterLanding = (
  baselines: readonly RatchetBaseline[],
  measured: readonly RatchetCount[],
  landed: LandedSha
): BaselinesAfterLanding => {
  // Each baseline reads the landing's first count for its key, as `first`
  // does for a ratchet with none yet.
  const lowered = baselines.flatMap((held) =>
    Array.findFirst(measured, sameRatchet(held)).pipe(
      Option.filter(({ count }) => count < held.count),
      Option.map(({ count }): Lowered => ({
        after: count,
        before: held.count,
        ratchet: held.ratchet,
        territory: held.territory,
      })),
      Option.toArray
    )
  );

  const kept = baselines.map((held) =>
    Option.match(Array.findFirst(lowered, sameRatchet(held)), {
      onNone: () => held,
      onSome: ({ after }) => ({ ...held, count: after, setAt: landed }),
    })
  );

  const first = Array.dedupeWith(
    measured.filter((count) => Option.isNone(baselineOf(baselines, count))),
    (one, other) => sameRatchet(one)(other)
  ).map(({ count, ratchet, territory }) => ({
    count,
    ratchet,
    setAt: landed,
    territory,
  }));

  return { baselines: [...kept, ...first], lowered };
};

/** Whether a choice gives a raise its way: `accept` (or `adopt`) does, `decline` and `revert` don't. */
const raisesOn = {
  accept: true,
  adopt: true,
  decline: false,
  revert: false,
} as const satisfies Record<Choice, boolean>;

/**
 * The baselines after a decider answered a `RaiseRatchet`: accepted, the
 * ratchet's baseline in that territory rises to the raised count, set at
 * `landed`; declined, nothing moves. The one way a baseline rises. An
 * accepted raise never lowers one: when another accepted raise already took
 * the baseline past this one's count, main may count that much, and a lower
 * baseline would refuse every later answer for a count it did not raise.
 */
export const decideRaise = (
  baselines: readonly RatchetBaseline[],
  subject: RaiseRatchet,
  choice: Choice,
  landed: LandedSha
): readonly RatchetBaseline[] => {
  if (!raisesOn[choice]) {
    return baselines;
  }

  const raised = {
    count: subject.after,
    ratchet: subject.ratchet,
    setAt: landed,
    territory: subject.territory,
  };

  return Option.match(baselineOf(baselines, subject), {
    onNone: () => [...baselines, raised],
    onSome: (held) =>
      held.count >= subject.after
        ? baselines
        : baselines.map((row) => (sameRatchet(subject)(row) ? raised : row)),
  });
};
