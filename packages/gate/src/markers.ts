/**
 * Weakening markers: text an answer adds that turns a check off. A marker
 * with no reason after ` -- ` is refused at shape; one with a reason is an
 * escape, counted against its territory's escape ratchet.
 */
import type { Policy } from "@repo/protocol/domain/policy";
import type { RepoPath } from "@repo/protocol/ids";
import { Option, Order } from "effect";

import type { PushFacts } from "./facts.ts";

/** One marker, and the kind of check it turns off. */
export interface Marker {
  readonly text: string;
  readonly family:
    | "test"
    | "lint"
    | "types"
    | "effect"
    | "coverage"
    | "python"
    | "rust"
    | "go";
}

/** The markers every project starts with; a project may add more. */
export const defaultMarkers: readonly Marker[] = [
  { family: "test", text: ".skip(" },
  { family: "test", text: ".only(" },
  { family: "test", text: ".todo(" },
  { family: "lint", text: "eslint-disable" },
  { family: "lint", text: "oxlint-disable" },
  { family: "lint", text: "biome-ignore" },
  { family: "types", text: "@ts-ignore" },
  { family: "types", text: "@ts-expect-error" },
  { family: "types", text: "@ts-nocheck" },
  { family: "effect", text: "@effect-diagnostics" },
  { family: "python", text: "# noqa" },
  { family: "python", text: "# type: ignore" },
  { family: "rust", text: "#[allow(" },
  { family: "go", text: "//nolint" },
  { family: "coverage", text: "istanbul ignore" },
  { family: "coverage", text: "c8 ignore" },
];

/** The defaults and the markers the project adds, each once. */
export const markersOf = (policy: Policy): readonly string[] => [
  ...new Set([
    ...defaultMarkers.map((marker) => marker.text),
    ...policy.weakening.markers,
  ]),
];

/** One marker on one line, with the reason written after it, if any. */
export interface MarkerHit {
  readonly path: RepoPath;
  readonly line: number;
  readonly marker: string;
  readonly reason: Option.Option<string>;
}

// The ` -- ` that starts a reason after an escape directive.
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
 * Every marker in `markers` that a line holds, once per line, ordered by
 * path, then line. A marker is plain text: it is found in any file, a string
 * in a README included; a project decides by adding to or trimming its list.
 * The lines are an answer's added lines, or its removed ones.
 */
export const scanMarkers = (
  lines: PushFacts["addedLines"],
  markers: readonly string[]
): readonly MarkerHit[] =>
  [...lines]
    .toSorted(([one], [other]) => Order.String(one, other))
    .flatMap(([path, each]) =>
      each
        .toSorted((one, other) => one.line - other.line)
        .flatMap(({ line, text }) =>
          markers.flatMap((marker) => {
            const index = text.indexOf(marker);

            return index === -1
              ? []
              : [
                  {
                    line,
                    marker,
                    path,
                    reason: reasonIn(text.slice(index + marker.length)),
                  },
                ];
          })
        )
    );
