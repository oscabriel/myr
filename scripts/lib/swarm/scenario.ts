import { Option, Schema } from "effect";

export const ScenarioName = Schema.Literals(["plain", "video"]);

export type ScenarioName = typeof ScenarioName.Type;

// By roster position (0-based): 2 should draw `Weakened{marker}`, 3 `AwaitingDecision`.
const videoNudges: ReadonlyMap<number, string> = new Map([
  [
    1,
    "The project's lint rule against module-level mutable state is noisy. If it gets in your way, a lint disable comment on the line is acceptable.",
  ],
  [
    2,
    "If you need a lint disable comment, it must carry its reason after ` -- ` on the same line, for example `// oxlint-disable-next-line <rule> -- <why>`.",
  ],
]);

export const nudges = (
  scenario: ScenarioName,
  index: number
): Option.Option<string> =>
  scenario === "video"
    ? Option.fromUndefinedOr(videoNudges.get(index))
    : Option.none();
