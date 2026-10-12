import type { AskListing } from "@repo/protocol/domain/ask";
import { AskId, ProjectName } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { Array, Option, Order, Result, Schema } from "effect";

import { Contributor, roster } from "./roster.ts";
import { nudges, ScenarioName } from "./scenario.ts";

export const Assignment = Schema.Struct({
  ask: AskId,
  contributor: Contributor,
  // Carried by the plan so the table and `--json` both show it: staging is never hidden.
  nudge: Schema.optionalKey(Schema.NonEmptyString),
  territory: Schema.NonEmptyString,
});

export type Assignment = typeof Assignment.Type;

export const SwarmPlan = Schema.Struct({
  assignments: Schema.Array(Assignment),
  held: Schema.Array(AskId),
  project: ProjectName,
  scenario: ScenarioName,
  stage: Schema.NonEmptyString,
});

export type SwarmPlan = typeof SwarmPlan.Type;

export class NotEnoughAsks extends Schema.TaggedError<NotEnoughAsks>()(
  "NotEnoughAsks",
  { open: Schema.Int, wanted: Schema.Int }
) {
  override get message() {
    return `${this.wanted} contributors, but only ${this.open} open, unclaimed, unblocked asks on disjoint territories`;
  }
}

// Every other refusal goes back into the same session: `retryable: true` means only
// that the same push may pass again, while `OutOfScope`, `Weakened` and
// `ChecksFailed` are exactly what an agent fixes.
export const endsClaim: ReadonlySet<Refusal["_tag"]> = new Set([
  "AskFull",
  "AttemptsExhausted",
  "ClaimLapsed",
  "Denounced",
  "NotClaimed",
  "NotVouched",
] as const satisfies readonly Refusal["_tag"][]);

const WHOLE_REPO = ".";

// A listing names only the module, so two different modules are taken as disjoint.
const overlaps = (one: string, other: string) =>
  one === other || one === WHOLE_REPO || other === WHOLE_REPO;

// By place in the whole roster, so a contributor planned alone (`--only`) gets the full run's nudge.
const nudgeFor = (scenario: ScenarioName, contributor: Contributor) =>
  Option.match(
    nudges(
      scenario,
      roster.findIndex(({ handle }) => handle === contributor.handle)
    ),
    {
      onNone: () => ({}),
      onSome: (nudge) => ({ nudge }),
    }
  );

export const planSwarm = (input: {
  readonly roster: readonly Contributor[];
  readonly asks: readonly AskListing[];
  readonly stage: string;
  readonly project: ProjectName;
  readonly scenario: ScenarioName;
}): Result.Result<SwarmPlan, NotEnoughAsks> => {
  const listed = new Set<string>(input.asks.map(({ ask }) => ask));

  const blocked = ({ blockedBy }: AskListing) =>
    blockedBy.some((waitsOn) => listed.has(waitsOn));

  const unclaimed = Array.sort(
    input.asks.filter(({ claimed }) => !claimed),
    Order.mapInput(Order.String, ({ ask }: AskListing) => ask)
  );

  const held = unclaimed.filter(blocked);
  const open = unclaimed.filter((listing) => !blocked(listing));

  const disjoint: AskListing[] = [];

  for (const listing of open) {
    if (
      !disjoint.some(({ territory }) => overlaps(territory, listing.territory))
    ) {
      disjoint.push(listing);
    }
  }

  const wanted = input.roster.length;

  if (disjoint.length < wanted) {
    return Result.fail(new NotEnoughAsks({ open: disjoint.length, wanted }));
  }

  return Result.succeed({
    assignments: Array.zipWith(
      input.roster,
      disjoint,
      (contributor, { ask, territory }) => ({
        ask,
        contributor,
        territory,
        ...nudgeFor(input.scenario, contributor),
      })
    ),
    held: held.map(({ ask }) => ask),
    project: input.project,
    scenario: input.scenario,
    stage: input.stage,
  });
};
