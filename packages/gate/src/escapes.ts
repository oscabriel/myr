/**
 * Reasoned escapes: a marker with a reason after ` -- ` is not refused but
 * counted against its territory's escape ratchet (FE §8.4 B2, B3). The
 * ratchet is incremental, with no command: its count moves by the reasoned
 * markers an answer adds minus those it removes. An answer that would take a
 * territory past its baseline waits for a decider, one `Waiver` per reasoned
 * marker it adds there, instead of landing or being refused.
 *
 * This is a pure function beside the stages, not a stage: a waiting answer
 * is not refused, so the caller (the Answer workflow, 417) opens the
 * decisions.
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

/** A `Waiver` decision's subject. */
export type Waiver = Extract<DecisionSubject, { readonly _tag: "Waiver" }>;

/**
 * The escape ratchet of `territory`: `escapes-` and the territory's name in
 * lowercase words joined by `-` (`@datekit/parse` is `escapes-datekit-parse`);
 * a territory with no such words, the root's `.`, is `escapes-root`.
 */
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

/** A marker hit whose line gives a reason. */
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

/**
 * The territory a path counts against: the first module holding it, or the
 * ask's territory for a path no module holds (a root manifest the ask may
 * change).
 */
const territoryOf = (policy: Policy, ask: Ask, path: RepoPath) =>
  policy.modules.find((module) => matchAny(module.paths, path))?.module ??
  ask.territory.module;

/**
 * One `Waiver` per reasoned marker the push adds, in each territory whose
 * escape count after the push (its count on main, plus the reasoned markers
 * added there, less those removed) exceeds its baseline; ordered by path,
 * then line. A push that answers no ask has nothing to wait on.
 */
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
