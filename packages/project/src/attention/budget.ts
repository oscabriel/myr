/**
 * The budget: how many decisions a decider takes a day. Each decision they
 * take and each finish they make is spent on the UTC day it happens, in one
 * row per decider and day; a finish costs more than a decision, so it is
 * counted apart, and a project can see where its deciders' time goes.
 */
import type { Policy } from "@repo/protocol/domain/policy";
import type { Handle } from "@repo/protocol/ids";
import { DateTime } from "effect";

import type { BudgetDayRow } from "../project-store/rows.ts";

/** One decider's budget for one day, as Today shows it. */
export interface Budget {
  /** Finishes made today, counted apart from decisions. */
  readonly finishes: number;
  /** The policy's decisions per day. */
  readonly total: number;
  /** Decisions taken today. */
  readonly used: number;
}

/** The day a moment falls on, as `BudgetDayRow.day` keys it: `2026-10-07`, in UTC. */
const dayOf = (now: DateTime.Utc) => DateTime.formatIsoDateUtc(now);

const rowFor = (
  days: readonly BudgetDayRow[],
  decider: Handle,
  now: DateTime.Utc
) => {
  const day = dayOf(now);

  return (
    days.find((row) => row.day === day && row.decider === decider) ?? {
      day,
      decider,
      finishes: 0,
      used: 0,
    }
  );
};

/** What `decider` has spent of today's budget, out of the policy's `decisionsPerDay`. */
export const budgetFor = (
  policy: Policy,
  decider: Handle,
  days: readonly BudgetDayRow[],
  now: DateTime.Utc
): Budget => {
  const { finishes, used } = rowFor(days, decider, now);

  return { finishes, total: policy.budget.decisionsPerDay, used };
};

/**
 * `decider`'s row for the day of `now`, with one more decision or finish
 * spent: the row the service writes back when they decide or finish.
 */
export const spend = (
  days: readonly BudgetDayRow[],
  input: {
    readonly decider: Handle;
    readonly on: "decision" | "finish";
    readonly now: DateTime.Utc;
  }
): BudgetDayRow => {
  const row = rowFor(days, input.decider, input.now);

  return input.on === "finish"
    ? { ...row, finishes: row.finishes + 1 }
    : { ...row, used: row.used + 1 };
};
