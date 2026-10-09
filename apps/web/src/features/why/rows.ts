/**
 * A "why" view as rows a reader scans: each range of lines with the commit
 * that brought it and, when the platform landed that commit, its landing
 * (the record's, never a trailer), plus the addresses each row links.
 */
import type { CommitView, WhyRange, WhyView } from "@repo/protocol/domain/code";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";

import { whyHref } from "../code/paths.ts";

/** One range of lines, the commit that brought it, and its landing when it is one. */
export interface WhyRow {
  readonly range: WhyRange;
  readonly commit: Option.Option<CommitView>;
  readonly landing: Option.Option<LandingView>;
}

/** The view's ranges, in line order, each with its commit and landing. */
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

/** The row holding line `line`, numbered from 1. */
export const rowAt = (rows: readonly WhyRow[], line: number) =>
  Option.fromUndefinedOr(
    rows.find(({ range }) => range.start <= line && line <= range.end)
  );

/** A range as a reader says it: "line 4", or "lines 1–3". */
export const linesWords = ({ end, start }: WhyRange) =>
  start === end ? `line ${start}` : `lines ${start}–${end}`;

/**
 * The ask a landing links, and how: the one it answers, or the one it
 * opened (a migrate family's parent). An opening answers nothing, so it
 * has no answer page and its link never reads as an answer.
 */
export type LandingAsk =
  | { readonly kind: "answers"; readonly ask: AskId }
  | { readonly kind: "opened"; readonly ask: AskId };

/** Which ask `landing` links and how; none for a decider's own landing or an adoption. */
export const askOf = (landing: LandingView): Option.Option<LandingAsk> => {
  if (landing.ask !== undefined) {
    return Option.some({ ask: landing.ask, kind: "answers" });
  }

  return Option.map(
    Option.fromUndefinedOr(landing.opened),
    (ask): LandingAsk => ({ ask, kind: "opened" })
  );
};

/** A count of credit as a reader says it. */
export const creditWords = (count: number) =>
  `${count} ${count === 1 ? "credit" : "credits"}`;

const isLanded = Outcome.isAnyOf(["Landed"]);

/** A landing's verdict in a word or two; none when it carries none. */
export const verdictWords = (landing: LandingView) =>
  Option.map(Option.fromUndefinedOr(landing.verdict), ({ outcome }) =>
    isLanded(outcome) ? "checked and landed" : outcome._tag
  );

/** The page of this file as it was before `commit`: why at its first parent. */
export const priorHref = (
  project: ProjectName,
  commit: CommitView,
  path: string
) =>
  Option.map(Option.fromUndefinedOr(commit.parents[0]), (parent) =>
    whyHref(project, parent, path)
  );

/** The propose form, about line `line` of `path` at the commit `at`. */
export const proposeHref = (
  project: ProjectName,
  {
    at,
    line,
    path,
  }: { readonly at: string; readonly line: number; readonly path: string }
) => {
  const query = new URLSearchParams({ about: path, at, line: String(line) });

  return `/${project}/proposals/new?${query.toString()}`;
};
