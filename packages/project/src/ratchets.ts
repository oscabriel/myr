import { sameRatchet } from "@repo/checks/kinds/ratchet";
import type {
  RaiseRatchet,
  RatchetCount,
  RatchetKey,
} from "@repo/checks/kinds/ratchet";
import type { Choice } from "@repo/protocol/domain/decision";
import type { LandedSha, RatchetName } from "@repo/protocol/ids";
import { Array, Option } from "effect";

export interface RatchetBaseline {
  readonly ratchet: RatchetName;
  readonly territory: string;
  readonly count: number;
  readonly setAt: LandedSha;
}

export interface Lowered {
  readonly ratchet: RatchetName;
  readonly territory: string;
  readonly before: number;
  readonly after: number;
}

export interface BaselinesAfterLanding {
  readonly baselines: readonly RatchetBaseline[];
  readonly lowered: readonly Lowered[];
}

const baselineOf = (baselines: readonly RatchetBaseline[], key: RatchetKey) =>
  Array.findFirst(baselines, sameRatchet(key));

/** A landing lowers baselines or sets new ones, never raises one: only an accepted `RaiseRatchet` does. */
export const afterLanding = (
  baselines: readonly RatchetBaseline[],
  measured: readonly RatchetCount[],
  landed: LandedSha
): BaselinesAfterLanding => {
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

const raisesOn = {
  accept: true,
  adopt: true,
  decline: false,
  revert: false,
} as const satisfies Record<Choice, boolean>;

/** An accepted raise never lowers a baseline another accepted raise already took past it. */
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
