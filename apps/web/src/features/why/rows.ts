import type { CommitView, WhyRange, WhyView } from "@repo/protocol/domain/code";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";

import { whyHref } from "../code/paths.ts";
import { pinnedRev } from "../code/rev.ts";

export interface WhyRow {
  readonly range: WhyRange;
  readonly commit: Option.Option<CommitView>;
  readonly landing: Option.Option<LandingView>;
}

export const rowsOf = (view: WhyView): readonly WhyRow[] => {
  const commits = new Map<string, CommitView>(
    view.commits.map((commit) => [commit.sha, commit])
  );

  const landings = new Map<string, LandingView>(
    view.landings.map((landing) => [landing.sha, landing])
  );

  return view.ranges.map((range) => ({
    commit: Option.fromUndefinedOr(commits.get(range.sha)),
    landing: Option.fromUndefinedOr(landings.get(range.sha)),
    range,
  }));
};

export const groupsOf = (view: WhyView): readonly WhyRow[] => {
  const groups: WhyRow[] = [];

  for (const row of rowsOf(view)) {
    const last = groups.at(-1);

    if (
      last !== undefined &&
      last.range.sha === row.range.sha &&
      last.range.end + 1 === row.range.start
    ) {
      groups[groups.length - 1] = {
        ...last,
        range: { ...last.range, end: row.range.end },
      };
    } else {
      groups.push(row);
    }
  }

  return groups;
};

export const rowAt = (rows: readonly WhyRow[], line: number) =>
  Option.fromUndefinedOr(
    rows.find(({ range }) => range.start <= line && line <= range.end)
  );

export const linesWords = ({ end, start }: WhyRange) =>
  start === end ? `line ${start}` : `lines ${start}–${end}`;

/** An opening answers nothing, so it has no answer page. */
export type LandingAsk =
  | { readonly kind: "answers"; readonly ask: AskId }
  | { readonly kind: "opened"; readonly ask: AskId };

export const askOf = (landing: LandingView): Option.Option<LandingAsk> => {
  if (landing.ask !== undefined) {
    return Option.some({ ask: landing.ask, kind: "answers" });
  }

  return Option.map(
    Option.fromUndefinedOr(landing.opened),
    (ask): LandingAsk => ({ ask, kind: "opened" })
  );
};

const isLanded = Outcome.isAnyOf(["Landed"]);

export const verdictWords = (landing: LandingView) =>
  Option.map(Option.fromUndefinedOr(landing.verdict), ({ outcome }) =>
    isLanded(outcome) ? "checked and landed" : outcome._tag
  );

/** Why at the commit's parent, inside the fork `rev` names when it names one. */
export const priorHref = (
  project: ProjectName,
  commit: CommitView,
  path: string,
  rev: string
) =>
  Option.map(Option.fromUndefinedOr(commit.parents[0]), (parent) =>
    whyHref(project, pinnedRev(rev, parent), path)
  );
