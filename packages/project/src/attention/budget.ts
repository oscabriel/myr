import type { Today } from "@repo/protocol/domain/decision";
import type { Policy } from "@repo/protocol/domain/policy";
import { sameHandle } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { DateTime } from "effect";

import type { BudgetDayRow } from "../project-store/rows.ts";

export type Budget = Today["budget"];

const dayOf = (now: DateTime.Utc) => DateTime.formatIsoDateUtc(now);

const rowFor = (
  days: readonly BudgetDayRow[],
  decider: Handle,
  now: DateTime.Utc
) => {
  const day = dayOf(now);

  return (
    days.find((row) => row.day === day && sameHandle(row.decider, decider)) ?? {
      day,
      decider,
      finishes: 0,
      used: 0,
    }
  );
};

export const budgetFor = (
  policy: Policy,
  decider: Handle,
  days: readonly BudgetDayRow[],
  now: DateTime.Utc
): Budget => {
  const { finishes, used } = rowFor(days, decider, now);

  return { finishes, total: policy.budget.decisionsPerDay, used };
};

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
