/**
 * The ratchet stage, after the cheap lane has counted: an answer may lower a
 * ratchet and never raise it. A raise the answer explains with a reasoned
 * escape in the ratchet's territory waits for a decider (FE §8.4); any other
 * raise is refused.
 */
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Policy } from "@repo/protocol/domain/policy";
import { Weakened } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Option } from "effect";

import type { PushFacts } from "../facts.ts";
import { matchAny } from "../glob.ts";
import { markersOf, scanMarkers } from "../markers.ts";

/** A territory's paths: a module's, by its name, or the territory read as a glob. */
const pathsOf = (policy: Policy, territory: string): readonly string[] =>
  policy.modules.find((module) => module.module === territory)?.paths ?? [
    territory,
  ];

/** The ratchet stage's answer: refusals, and the decisions the answer waits on. */
export interface RatchetAnswer {
  readonly refusals: readonly Refusal[];
  readonly decisions: readonly DecisionSubject[];
}

/** Refuses each raised ratchet, or turns it into a `RaiseRatchet` decision. */
export const ratchet = (facts: PushFacts): RatchetAnswer => {
  const escapes = scanMarkers(facts.addedLines, markersOf(facts.policy)).filter(
    (hit) => Option.isSome(hit.reason)
  );

  // A raise waits for a decider only when the answer adds a reasoned escape
  // in the ratchet's territory. A decider's own landing has no ask to wait
  // on, so nothing it raises is explained.
  const raised = [...facts.ratchetCounts].flatMap(([name, count]) =>
    count.after > count.before
      ? [
          {
            count,
            explained:
              Option.isSome(facts.ask) &&
              escapes.some((hit) =>
                matchAny(pathsOf(facts.policy, count.territory), hit.path)
              ),
            name,
          },
        ]
      : []
  );

  return {
    decisions: Option.match(facts.ask, {
      onNone: () => [],
      onSome: (ask) =>
        raised.flatMap(({ count, explained, name }) =>
          explained
            ? [
                DecisionSubject.cases.RaiseRatchet.make({
                  ...count,
                  ask: ask.id,
                  ratchet: name,
                }),
              ]
            : []
        ),
    }),
    refusals: raised.flatMap(({ count, explained, name }) =>
      explained
        ? []
        : [new Weakened({ weakening: { ...count, ratchet: name } })]
    ),
  };
};
