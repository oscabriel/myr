/**
 * Weakening markers: text an answer adds that turns a check off. A marker
 * with no reason after ` -- ` is refused at shape; one with a reason is an
 * escape, counted against its territory's ratchet (FE §8.4).
 */
import type { At } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import { Option, Order } from "effect";

import type { PushFacts } from "./facts.ts";

/** The markers every project starts with (spec §4.2); a project may add more. */
export const defaultMarkers: readonly string[] = [
  ".skip(",
  ".only(",
  ".todo(",
  "eslint-disable",
  "oxlint-disable",
  "biome-ignore",
  "@ts-ignore",
  "@ts-expect-error",
  "@ts-nocheck",
  "@effect-diagnostics",
  "# noqa",
  "# type: ignore",
  "#[allow(",
  "//nolint",
  "istanbul ignore",
  "c8 ignore",
];

/** The defaults and the markers the project adds, each once. */
export const markersOf = (policy: Policy): readonly string[] => [
  ...new Set([...defaultMarkers, ...policy.weakening.markers]),
];

/** One marker on one added line, with the reason written after it, if any. */
export interface MarkerHit {
  readonly marker: string;
  readonly at: At;
  readonly reason: Option.Option<string>;
}

// The ` -- ` that starts a reason, as the debt ledger reads it.
const REASON_MARK = /\s--(?=\s|$)/u;

// What closes a comment after its reason: `*/`, `-->`.
const CLOSER = /\s*(?:\*\/|-->)\s*$/u;

/** The reason written after a marker on its line, if there is one. */
const reasonIn = (rest: string): Option.Option<string> => {
  const mark = REASON_MARK.exec(rest);

  if (mark === null) {
    return Option.none();
  }

  const reason = rest
    .slice(mark.index + mark[0].length)
    .replace(CLOSER, "")
    .trim();

  return reason === "" ? Option.none() : Option.some(reason);
};

/**
 * Every marker in `markers` that an added line holds, once per line, ordered
 * by path, then line. A marker is plain text: it is found in any file, a
 * string in a README included.
 */
export const findMarkers = (
  markers: readonly string[],
  added: PushFacts["addedLines"]
): readonly MarkerHit[] =>
  [...added]
    .toSorted(([one], [other]) => Order.String(one, other))
    .flatMap(([path, lines]) =>
      lines
        .toSorted((one, other) => one.line - other.line)
        .flatMap(({ line, text }) =>
          markers.flatMap((marker) => {
            const index = text.indexOf(marker);

            return index === -1
              ? []
              : [
                  {
                    at: { line, path },
                    marker,
                    reason: reasonIn(text.slice(index + marker.length)),
                  },
                ];
          })
        )
    );
