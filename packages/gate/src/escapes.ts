/**
 * A pure function beside the stages, not a stage: a waiting answer is not
 * refused, so the caller (the Project DO) opens the decisions.
 */
import type { Ask } from "@repo/protocol/domain/ask";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Policy } from "@repo/protocol/domain/policy";
import { RatchetName } from "@repo/protocol/ids";
import type { RepoPath } from "@repo/protocol/ids";
import { Option } from "effect";

import type { PushFacts } from "./facts.ts";
import { matchAny } from "./glob.ts";
import { markersOf, scanMarkers } from "./markers.ts";
import type { MarkerHit } from "./markers.ts";

export type Waiver = Extract<DecisionSubject, { readonly _tag: "Waiver" }>;

export interface RaiseRequest {
  readonly ratchet: RatchetName;
  readonly territory: string;
  readonly reason: string;
}

export const escapeRatchet = (territory: string): RatchetName =>
  RatchetName.make(
    `escapes-${
      territory
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter((word) => word !== "")
        .join("-") || "root"
    }`
  );

interface Escape extends MarkerHit {
  readonly given: string;
}

const escapesIn = (
  lines: PushFacts["addedLines"],
  markers: readonly string[]
): readonly Escape[] =>
  scanMarkers(lines, markers).flatMap((hit) =>
    Option.match(hit.reason, {
      onNone: () => [],
      onSome: (given) => [{ ...hit, given }],
    })
  );

export const territoryOf = (policy: Policy, ask: Ask, path: RepoPath) =>
  policy.modules.find((module) => matchAny(module.paths, path))?.module ??
  ask.territory.module;

export const escapeDecisions = (facts: PushFacts): readonly Waiver[] =>
  Option.match(facts.ask, {
    onNone: () => [],
    onSome: (ask) => {
      const markers = markersOf(facts.policy);
      const added = escapesIn(facts.addedLines, markers);
      const removed = escapesIn(facts.removedLines ?? new Map(), markers);

      const territory = (hit: Escape) =>
        territoryOf(facts.policy, ask, hit.path);

      const raises = (name: string) => {
        const ratchet = escapeRatchet(name);
        const baseline = facts.ratchetBaselines?.get(ratchet) ?? 0;
        const onMain = facts.escapeCounts?.get(ratchet) ?? baseline;

        const moved = (hits: readonly Escape[]) =>
          hits.filter((hit) => territory(hit) === name).length;

        return onMain + moved(added) - moved(removed) > baseline;
      };

      return added
        .filter((hit) => raises(territory(hit)))
        .map(({ given, line, marker, path }) =>
          DecisionSubject.cases.Waiver.make({
            ask: ask.id,
            at: { line, path },
            marker,
            reason: given,
          })
        );
    },
  });

export const explainedRaises = (
  policy: Policy,
  ask: Ask,
  waivers: readonly Waiver[]
): readonly RaiseRequest[] =>
  waivers.flatMap((waiver) =>
    policy.ratchets.map(({ name: ratchet }) => ({
      ratchet,
      reason: waiver.reason,
      territory: territoryOf(policy, ask, waiver.at.path),
    }))
  );
