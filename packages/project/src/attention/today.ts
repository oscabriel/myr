import type { CreditRole } from "@repo/protocol/domain/credit";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import type { LandingView } from "@repo/protocol/domain/landing";
import { sameHandle } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Order } from "effect";

import type { Budget } from "./budget.ts";

const soon = { hours: 24 } as const;

const welcome = { days: 7 } as const;

const sampled = 5;

const attended: ReadonlySet<CreditRole> = new Set([
  "Decided-by",
  "Finished-by",
]);

const byExpiry: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

const newestFirst: Order.Order<LandingView> = Order.combine(
  Order.flip(
    Order.mapInput(DateTime.Order, ({ landedAt }: LandingView) => landedAt)
  ),
  Order.mapInput(Order.String, ({ sha }: LandingView) => sha)
);

const isUnattended = (landing: LandingView) =>
  landing.ask !== undefined &&
  !landing.credits.some(({ role }) => attended.has(role));

export const today = (input: {
  readonly decider: Handle;
  readonly decisions: readonly Decision[];
  readonly budget: Budget;
  readonly firstClaims: readonly {
    readonly handle: Handle;
    readonly at: DateTime.Utc;
  }[];
  readonly landings: readonly LandingView[];
  readonly now: DateTime.Utc;
}): Today => {
  const { budget, decider, now } = input;

  const theirs = Arr.sort(
    input.decisions.filter(
      (decision) =>
        decision.decided === undefined &&
        decision.deciders.some((each) => sameHandle(each, decider)) &&
        DateTime.isLessThan(now, decision.expiresAt)
    ),
    byExpiry
  );

  const room = Math.max(0, budget.total - budget.used);
  const shown = theirs.slice(0, room);
  const until = DateTime.add(now, soon);
  const since = DateTime.subtract(now, welcome);

  return {
    budget,
    decider,
    decisions: shown,
    expiringSoon: theirs
      .filter(({ expiresAt }) => DateTime.isLessThanOrEqualTo(expiresAt, until))
      .map(({ id }) => id),
    newcomers: Arr.dedupe(
      input.firstClaims
        .filter(({ at }) => DateTime.isGreaterThanOrEqualTo(at, since))
        .map(({ handle }) => handle)
    ),
    overflow: theirs.length - shown.length,
    unattended: Arr.sort(
      input.landings.filter(isUnattended),
      newestFirst
    ).slice(0, sampled),
  };
};
