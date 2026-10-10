/**
 * Today's reads and a decider's writes, as the web's atoms make them: kept
 * from an anonymous browser, a decider's own, and refetched once a decision
 * is taken.
 * Over the dev world in process (`dev-browser.ts`).
 */
import { describe, expect, it } from "@effect/vitest";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { Unauthenticated } from "@repo/protocol/principal";
import { Array, DateTime, Effect, Exit, Option, Schema } from "effect";

import { keys } from "../src/client/keys.ts";
import { ContractsClient } from "../src/surfaces.ts";
import { DECIDER, registryAs, seededWorld, settled } from "./dev-browser.ts";

const todayAtom = ContractsClient.query(
  "today",
  {},
  { reactivityKeys: keys.today() }
);

describe("Today, through the web's atoms", seededWorld, () => {
  it.live("keeps Today from an anonymous browser", () =>
    Effect.gen(function* () {
      const anonymous = yield* settled(registryAs(), todayAtom);

      const refused = Exit.isFailure(anonymous)
        ? Option.getOrUndefined(Exit.findErrorOption(anonymous))
        : undefined;

      expect(Schema.is(Unauthenticated)(refused)).toBeTruthy();
    })
  );

  it.live("shows the decider their Today, with the seed's decisions", () =>
    Effect.gen(function* () {
      const today = yield* settled(registryAs(DECIDER), todayAtom);

      expect(
        Exit.isSuccess(today)
          ? {
              budget: today.value.budget,
              decider: today.value.decider,
              newcomers: today.value.newcomers,
              projects: Array.dedupe(
                today.value.decisions.map(({ project }) => project)
              ),
              subjects: today.value.decisions
                .map(({ subject }) => subject._tag)
                .toSorted(),
              unattended: today.value.unattended.map(({ ask }) => ask),
            }
          : undefined
      ).toStrictEqual({
        budget: { finishes: 0, total: 5, used: 2 },
        decider: "ines-v",
        newcomers: ["bram"],
        projects: ["datekit"],
        subjects: ["OpenProposal", "OpenProposal", "StrayPush"],
        unattended: ["diff-in-days-dst"],
      });
    })
  );

  // The page's atoms live in a registry of the page's own (`SeededAtoms`),
  // the rail's in the root's: a decision taken on the page refetches both.
  it.live(
    "closes a decision the decider declines, and Today refetches without it, on the page and in the rail",
    () =>
      Effect.gen(function* () {
        const registry = registryAs(DECIDER);
        const rail = registryAs(DECIDER);
        const unmount = registry.mount(todayAtom);
        const unmountRail = rail.mount(todayAtom);
        const before = yield* settled(registry, todayAtom);
        // Read in the rail before the decision, so a refetch is what changes it.
        yield* settled(rail, todayAtom);

        const proposal = Exit.isSuccess(before)
          ? before.value.decisions.find(({ subject }) =>
              DecisionSubject.guards.OpenProposal(subject)
            )
          : undefined;

        expect(proposal).toBeDefined();

        if (proposal === undefined) {
          return;
        }

        const decide = ContractsClient.mutation("decide");

        registry.set(decide, {
          payload: {
            choice: "decline",
            decision: proposal.id,
            project: proposal.project,
          },
          reactivityKeys: [...keys.today(), ...keys.project(proposal.project)],
        });

        const decided = yield* settled(registry, decide);

        const taken = Exit.isSuccess(decided)
          ? decided.value.decision.decided
          : undefined;

        expect(taken?.choice).toBe("decline");
        // The world serves at the instant its seed left the clock.
        expect(
          taken === undefined ? undefined : DateTime.formatIso(taken.at)
        ).toBe("2026-10-07T09:21:00.000Z");

        /** Whether Today, in `where`, still holds the decision, and the budget it has used. */
        const todayIn = (where: typeof registry) =>
          Effect.map(settled(where, todayAtom), (today) =>
            Exit.isSuccess(today)
              ? {
                  holds: today.value.decisions.some(
                    ({ id }) => id === proposal.id
                  ),
                  used: today.value.budget.used,
                }
              : undefined
          );

        expect({
          page: yield* todayIn(registry),
          rail: yield* todayIn(rail),
        }).toStrictEqual({
          page: { holds: false, used: 3 },
          rail: { holds: false, used: 3 },
        });

        unmount();
        unmountRail();
      })
  );
});
