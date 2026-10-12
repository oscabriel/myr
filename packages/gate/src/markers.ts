import type { Policy } from "@repo/protocol/domain/policy";
import type { RepoPath } from "@repo/protocol/ids";
import { Option, Order } from "effect";

import type { PushFacts } from "./facts.ts";

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

export const markersOf = (policy: Policy): readonly string[] => [
  ...new Set([
    ...defaultMarkers.map((marker) => marker.text),
    ...policy.weakening.markers,
  ]),
];

export interface MarkerHit {
  readonly path: RepoPath;
  readonly line: number;
  readonly marker: string;
  readonly reason: Option.Option<string>;
}

const REASON_MARK = /\s--(?=\s|$)/u;

const CLOSER = /\s*(?:\*\/|-->)\s*$/u;

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
 * A marker is plain text: it is found in any file, a README included; a
 * project decides by adding to or trimming its list.
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
