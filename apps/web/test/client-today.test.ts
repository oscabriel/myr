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

  it.live(
    "closes a decision the decider declines, and Today refetches without it",
    () =>
      Effect.gen(function* () {
        const registry = registryAs(DECIDER);
        const unmount = registry.mount(todayAtom);
        const before = yield* settled(registry, todayAtom);

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

        const after = yield* settled(registry, todayAtom);

        expect(
          Exit.isSuccess(after)
            ? after.value.decisions.map(({ id }) => id).includes(proposal.id)
            : true
        ).toBeFalsy();
        expect(Exit.isSuccess(after) ? after.value.budget.used : 0).toBe(3);

        unmount();
      })
  );
});
