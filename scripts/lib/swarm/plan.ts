/**
 * The swarm's plan: which contributor answers which ask. It takes a
 * project's open asks as `listAsks` shows them, and hands each contributor,
 * in roster order, one open, unclaimed, unblocked ask, in `AskId` order, on
 * a territory no other assignment shares. Asks still blocked (a migrate
 * family's delete child, and its parent) are held.
 */
import type { AskListing } from "@repo/protocol/domain/ask";
import { AskId, ProjectName } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { Array, Order, Result, Schema } from "effect";

import { Contributor } from "./roster.ts";
import { ScenarioName } from "./scenario.ts";

/** One contributor's ask, and the territory (module) it may change. */
export const Assignment = Schema.Struct({
  ask: AskId,
  contributor: Contributor,
  territory: Schema.NonEmptyString,
});

export type Assignment = typeof Assignment.Type;

/** The plan for one run: its assignments, and the asks it holds back. */
export const SwarmPlan = Schema.Struct({
  assignments: Schema.Array(Assignment),
  /** Open asks still blocked by others: a migrate family's delete child, say. */
  held: Schema.Array(AskId),
  project: ProjectName,
  scenario: ScenarioName,
  stage: Schema.NonEmptyString,
});

export type SwarmPlan = typeof SwarmPlan.Type;

/** Fewer asks can be handed out than the roster has contributors. */
export class NotEnoughAsks extends Schema.TaggedError<NotEnoughAsks>()(
  "NotEnoughAsks",
  { open: Schema.Int, wanted: Schema.Int }
) {
  override get message() {
    return `${this.wanted} contributors, but only ${this.open} open, unclaimed, unblocked asks on disjoint territories`;
  }
}

/**
 * The refusals that end a contributor's claim, so the verdict loop (711)
 * stops on them. It bounces every other refusal back into the same session:
 * `retryable: true` means only that the same push may pass if sent again
 * (`StaleBase`, `RepoBusy`, `Flake`), while `OutOfScope`, `Weakened` and
 * `ChecksFailed` (`retryable: false`) are exactly what an agent fixes.
 */
export const endsClaim: ReadonlySet<Refusal["_tag"]> = new Set([
  "AskFull",
  "AttemptsExhausted",
  "ClaimLapsed",
  "Denounced",
  "NotClaimed",
  "NotVouched",
] as const satisfies readonly Refusal["_tag"][]);

/** The whole repo as a territory: it overlaps every other one. */
const WHOLE_REPO = ".";

/**
 * Whether two asks' territories overlap: the same module, or either one
 * the whole repo. A listing names only the module, so two modules that are
 * not the same are taken as disjoint (each is one workspace package).
 */
const overlaps = (one: string, other: string) =>
  one === other || one === WHOLE_REPO || other === WHOLE_REPO;

/**
 * Plans a run: each contributor in `roster`, in roster order, gets one open,
 * unclaimed and unblocked ask, taken in `AskId` order, whose territory
 * overlaps no ask already handed out. An ask is blocked while any ask it
 * waits on is still listed (`listAsks` lists every ask not closed); blocked
 * asks are held. With fewer asks to hand out than contributors, the plan
 * fails `NotEnoughAsks`, counting the asks it could hand out.
 */
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
      (contributor, { ask, territory }) => ({ ask, contributor, territory })
    ),
    held: held.map(({ ask }) => ask),
    project: input.project,
    scenario: input.scenario,
    stage: input.stage,
  });
};
