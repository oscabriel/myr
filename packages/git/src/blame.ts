/**
 * First-parent blame, pure: given one file's versions newest first (one
 * per first-parent commit that changed its blob), each line of the newest
 * goes to the oldest version that still holds it unchanged, found by a
 * line diff (`line-diff.ts`) between each version and the one before it.
 * Lines the oldest version given still holds go to it: the caller knows
 * whether that version brought them or the walk stopped there. A caller
 * that reads versions one at a time folds them with `traceBack`, so only
 * two are held at once.
 */
import type { WhyRange } from "@repo/protocol/domain/code";
import type { CommitSha } from "@repo/protocol/ids";

import { Edit, lineDiff } from "./line-diff.ts";

/** One version of a file: the commit that made it, and its text. */
export interface Version {
  readonly sha: CommitSha;
  readonly text: string;
}

/** Why each line is there, and whether any went to the oldest version given. */
export interface Blame {
  readonly ranges: readonly WhyRange[];
  readonly reachedEnd: boolean;
}

/** A text's lines, without the empty one after a final newline. */
export const linesOf = (text: string): readonly string[] => {
  if (text === "") {
    return [];
  }

  const lines = text.split("\n");

  if (text.endsWith("\n")) {
    lines.pop();
  }

  return lines;
};

/** Where each line of `after` sits in `before`, or -1 for a line `before` lacks. */
const originsOf = (before: readonly string[], after: readonly string[]) => {
  const origins = new Int32Array(after.length).fill(-1);

  for (const edit of lineDiff(before, after)) {
    if (Edit.$is("Equal")(edit)) {
      for (let at = 0; at < edit.count; at += 1) {
        origins[edit.newStart + at] = edit.oldStart + at;
      }
    }
  }

  return origins;
};

/** Each line's version as ranges of consecutive lines, numbered from 1. */
const rangesOf = (owners: readonly CommitSha[]): readonly WhyRange[] => {
  const ranges: WhyRange[] = [];

  for (const [index, sha] of owners.entries()) {
    const last = ranges.at(-1);
    const line = index + 1;

    if (last !== undefined && last.sha === sha && last.end === index) {
      ranges[ranges.length - 1] = { ...last, end: line };
    } else {
      ranges.push({ end: line, sha, start: line });
    }
  }

  return ranges;
};

/**
 * A blame under way: the newest version's lines each given a version, or
 * still open at a line of the version reached so far.
 */
export interface Tracing {
  /** Each line's version, or null while it is open. */
  readonly owners: readonly (CommitSha | null)[];
  /** Each open line of the newest, by where it sits in `lines`. */
  readonly open: ReadonlyMap<number, number>;
  readonly lines: readonly string[];
  readonly sha: CommitSha;
}

/** A blame of `newest`, every line open. */
export const blameFrom = (newest: Version): Tracing => {
  const lines = linesOf(newest.text);

  return {
    lines,
    open: new Map(lines.map((_, line) => [line, line])),
    owners: lines.map(() => null),
    sha: newest.sha,
  };
};

/** Whether every line has its version, so no older one need be read. */
export const isSettled = (tracing: Tracing) => tracing.open.size === 0;

/**
 * `tracing` taken back to `older`, the version before the one it reached:
 * each open line `older` lacks goes to the version reached.
 */
export const traceBack = (tracing: Tracing, older: Version): Tracing => {
  const lines = linesOf(older.text);
  const origins = originsOf(lines, tracing.lines);
  const owners = [...tracing.owners];
  const open = new Map<number, number>();

  for (const [line, at] of tracing.open) {
    const origin = origins[at] ?? -1;

    if (origin === -1) {
      owners[line] = tracing.sha;
    } else {
      open.set(line, origin);
    }
  }

  return { lines, open, owners, sha: older.sha };
};

/** Why each line is there, the open lines going to the version reached. */
export const settle = (tracing: Tracing): Blame => ({
  ranges: rangesOf(tracing.owners.map((owner) => owner ?? tracing.sha)),
  reachedEnd: tracing.open.size > 0,
});

/** Why each line of the newest of `versions` (newest first) is there. */
export const blame = (versions: readonly Version[]): Blame => {
  const [newest, ...older] = versions;

  if (newest === undefined) {
    return { ranges: [], reachedEnd: false };
  }

  let tracing = blameFrom(newest);

  for (const version of older) {
    if (isSettled(tracing)) {
      break;
    }

    tracing = traceBack(tracing, version);
  }

  return settle(tracing);
};
