/**
 * Lines the oldest version given still holds go to it: the caller knows
 * whether that version brought them or the walk stopped there.
 */
import type { WhyRange } from "@repo/protocol/domain/code";
import type { CommitSha } from "@repo/protocol/ids";

import { Edit, lineDiff } from "./line-diff.ts";

export interface Version {
  readonly sha: CommitSha;
  readonly text: string;
}

export interface Blame {
  readonly ranges: readonly WhyRange[];
  readonly reachedEnd: boolean;
}

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

export interface Tracing {
  readonly owners: readonly (CommitSha | null)[];
  readonly open: ReadonlyMap<number, number>;
  readonly lines: readonly string[];
  readonly sha: CommitSha;
}

export const blameFrom = (newest: Version): Tracing => {
  const lines = linesOf(newest.text);

  return {
    lines,
    open: new Map(lines.map((_, line) => [line, line])),
    owners: lines.map(() => null),
    sha: newest.sha,
  };
};

export const isSettled = (tracing: Tracing) => tracing.open.size === 0;

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

export const settle = (tracing: Tracing): Blame => ({
  ranges: rangesOf(tracing.owners.map((owner) => owner ?? tracing.sha)),
  reachedEnd: tracing.open.size > 0,
});

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
