/**
 * Today: a decider's daily page. Their open decisions in order of expiry,
 * held to what is left of the day's budget, with the rest counted as
 * overflow (it waits, and may expire to its safe default); the decisions
 * about to expire; the people to welcome; and a sample of what landed
 * without anyone. A pure function of the project's rows and `now`.
 */
import type { CreditRole } from "@repo/protocol/domain/credit";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { Handle } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Order } from "effect";

import type { Budget } from "./budget.ts";

/** How near its expiry a decision is called out. */
const soon = { hours: 24 } as const;

/** How recent a first claim makes a newcomer. */
const welcome = { days: 7 } as const;

/** How many unattended landings Today samples. */
const sampled = 5;

/** The credit a decider's attention leaves on a landing. */
const attended: ReadonlySet<CreditRole> = new Set([
  "Decided-by",
  "Finished-by",
]);

/** By expiry, then by opening, then by id: the same order every time. */
const byExpiry: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

/** Newest first, then by SHA. */
const newestFirst: Order.Order<LandingView> = Order.combine(
  Order.flip(
    Order.mapInput(DateTime.Order, ({ landedAt }: LandingView) => landedAt)
  ),
  Order.mapInput(Order.String, ({ sha }: LandingView) => sha)
);

/**
 * A landing that needed nobody: it answered an ask, and no decider decided
 * on it or finished it. A decider's own landing answers no ask.
 */
const isUnattended = (landing: LandingView) =>
  landing.ask !== undefined &&
  !landing.credits.some(({ role }) => attended.has(role));

/**
 * `decider`'s Today. Their decisions are the open ones that name them among
 * the deciders (set by `decidersFor` when each opened) and have not reached
 * their expiry. Today shows as many as `budget.total - budget.used` allows,
 * soonest to expire first, and counts the rest as `overflow`.
 * `expiringSoon` names every one of theirs that expires within 24 hours,
 * shown or not. `newcomers` are the people whose first claim was within the
 * last 7 days; `unattended` the newest 5 landings that needed nobody.
 */
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
        decision.deciders.includes(decider) &&
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
