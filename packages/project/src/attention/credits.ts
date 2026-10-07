/**
 * A person's credits (GLOSSARY "Credit"): how many landings name them in
 * each human role, by project and area, for their credits page. Roles and
 * counts only: no score, no total across roles, no ranking (spec §1.4).
 *
 * Credit is read from each landing's `credits` rows, which the platform wrote
 * as the landing's trailers, never from commit messages. `Assisted-by` is a
 * disclosure of the agent a person worked through, kept apart in `assisted`,
 * and never counts.
 */
import type { Ask } from "@repo/protocol/domain/ask";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { CreditSummary } from "@repo/protocol/domain/record";
import type { AskId, Handle } from "@repo/protocol/ids";
import { Array as Arr, Option, Order } from "effect";

import { areaOf, sameHandle } from "./record.ts";

/** What a person's credits are counted from. */
export interface CreditsInput {
  /** The asks the landings answered, by id, closed ones included, to find each landing's area. */
  readonly asks: ReadonlyMap<AskId, Ask>;
  readonly handle: Handle;
  readonly landings: readonly LandingView[];
}

const byText = (field: (row: CreditSummary) => string) =>
  Order.mapInput(Order.String, field);

/**
 * By project, then area, then role, each as text. Not `Order.Struct`: it
 * compares in key order, and keys are kept sorted.
 */
const bySummary = Order.combineAll([
  byText(({ project }) => project),
  byText(({ area }) => area),
  byText(({ role }) => role),
]);

/**
 * One row per project, area and role the person holds, counting the landings
 * that credit them so; a role repeated on one landing counts once. A landing
 * with no area (no ask, or one not found) credits no area, so it is not
 * counted, as on the record. Rows are sorted by project, area and role.
 */
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
