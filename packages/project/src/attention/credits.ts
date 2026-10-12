import type { Ask } from "@repo/protocol/domain/ask";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { CreditSummary } from "@repo/protocol/domain/record";
import { sameHandle } from "@repo/protocol/ids";
import type { AskId, Handle } from "@repo/protocol/ids";
import { Array as Arr, Option, Order } from "effect";

import { areaOf } from "./record.ts";

export interface CreditsInput {
  /** Ask ids are unique only within a project: call once per project and join the rows. */
  readonly asks: ReadonlyMap<AskId, Ask>;
  readonly handle: Handle;
  readonly landings: readonly LandingView[];
}

const byText = (field: (row: CreditSummary) => string) =>
  Order.mapInput(Order.String, field);

// Not `Order.Struct`: it compares in key order, and keys are kept sorted.
const bySummary = Order.combineAll([
  byText(({ project }) => project),
  byText(({ area }) => area),
  byText(({ role }) => role),
]);

export const creditsByArea = (
  input: CreditsInput
): readonly CreditSummary[] => {
  const rows = new Map<string, CreditSummary>();

  for (const landing of input.landings) {
    const area = areaOf(landing, input.asks);

    if (Option.isNone(area)) {
      continue;
    }

    const roles = Arr.dedupe(
      landing.credits
        .filter(({ handle }) => sameHandle(handle, input.handle))
        .map(({ role }) => role)
    );

    for (const role of roles) {
      const key = JSON.stringify([landing.project, area.value, role]);
      const seen = rows.get(key);

      rows.set(key, {
        area: area.value,
        count: (seen?.count ?? 0) + 1,
        project: landing.project,
        role,
      });
    }
  }

  return Arr.sort(rows.values(), bySummary);
};
