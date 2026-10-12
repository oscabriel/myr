/**
 * Scenarios: the nudges the swarm adds to some contributors' briefs, so a
 * recorded take shows the refusals the video's beat names (1:30–2:15;
 * `.agents/demo/swarm-scenario.md` documents them). `plain` nudges nobody. Every
 * nudge is printed in the plan: staging is never hidden.
 */
import { Option, Schema } from "effect";

/** The swarm's scenarios. */
export const ScenarioName = Schema.Literals(["plain", "video"]);

export type ScenarioName = typeof ScenarioName.Type;

/**
 * The `video` scenario's nudges, by roster position (0-based): contributor
 * 2 is told a disable comment is fine (expect `Weakened{marker}` for one with
 * no reason); contributor 3 is told a disable comment carries its reason
 * after ` -- ` (expect `AwaitingDecision`).
 */
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

/** The nudge `scenario` adds to the brief of the contributor at roster position `index`, if any. */
export const nudges = (
  scenario: ScenarioName,
  index: number
): Option.Option<string> =>
  scenario === "video"
    ? Option.fromUndefinedOr(videoNudges.get(index))
    : Option.none();
