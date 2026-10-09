/**
 * A line diff with no dependency: the whole edit script from one file's
 * lines to another's, as runs of equal, deleted and inserted lines. The
 * shortest script is Myers' O(ND) diff over the lines left once the shared
 * head and tail are set aside; past `MAX_EDITS` edits it stops looking for
 * the shortest, and the script keeps only the lines found once in each
 * file, in order (git's patience anchors, matched greedily).
 *
 * Positions are 0-based: an edit starts at `oldStart` in the old lines and
 * `newStart` in the new, and in a run of changes the deletions come first.
 */
import { Data, Option } from "effect";

/** `count` lines from `oldStart` in the old lines and `newStart` in the new. */
interface Span {
  readonly oldStart: number;
  readonly newStart: number;
  readonly count: number;
}

/** One run of an edit script: lines both files share, or lines one alone holds. */
export type Edit = Data.TaggedEnum<{
  Delete: Span;
  Equal: Span;
  Insert: Span;
}>;

export const Edit = Data.taggedEnum<Edit>();

/** One line's step through the script. */
type Step = Edit["_tag"];

// Past this many edits the diff stops looking for the shortest script.
const MAX_EDITS = 1024;

const at = (values: Int32Array, index: number) => values[index] ?? 0;

/**
 * The steps of the script ending at `(n, m)`, read back from `trace`, where
 * `trace[d]` holds diagonals `-d..d` after `d` edits.
 */
const stepsFrom = (
  trace: readonly Int32Array[],
  ends: { readonly n: number; readonly m: number }
) => {
  const steps: Step[] = [];
  let x = ends.n;
  let y = ends.m;

  for (let edits = trace.length - 1; edits > 0; edits -= 1) {
    const previous = trace[edits - 1] ?? new Int32Array();
    const diagonal = x - y;

    const reached = (k: number) => at(previous, k + edits - 1);

    const down =
      diagonal === -edits ||
      (diagonal !== edits && reached(diagonal - 1) < reached(diagonal + 1));

    const from = down ? diagonal + 1 : diagonal - 1;
    const fromX = reached(from);
    const snakeX = down ? fromX : fromX + 1;

    for (; x > snakeX; x -= 1) {
      steps.push("Equal");
    }

    steps.push(down ? "Insert" : "Delete");
    x = fromX;
    y = fromX - from;
  }

  for (; x > 0; x -= 1) {
    steps.push("Equal");
  }

  return steps.toReversed();
};

/** A shortest edit script from `previous` to `next`, or none past `MAX_EDITS`. */
const myers = (
  previous: readonly string[],
  next: readonly string[]
): Option.Option<readonly Step[]> => {
  const n = previous.length;
  const m = next.length;
  const limit = Math.min(n + m, MAX_EDITS);
  const offset = limit + 1;
  const reach = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];

  for (let edits = 0; edits <= limit; edits += 1) {
    for (let diagonal = -edits; diagonal <= edits; diagonal += 2) {
      let x =
        diagonal === -edits ||
        (diagonal !== edits &&
          at(reach, offset + diagonal - 1) < at(reach, offset + diagonal + 1))
          ? at(reach, offset + diagonal + 1)
          : at(reach, offset + diagonal - 1) + 1;

      let y = x - diagonal;

      while (x < n && y < m && previous[x] === next[y]) {
        x += 1;
        y += 1;
      }

      reach[offset + diagonal] = x;

      if (x >= n && y >= m) {
        trace.push(reach.slice(offset - edits, offset + edits + 1));

        return Option.some(stepsFrom(trace, { m, n }));
      }
    }

    trace.push(reach.slice(offset - edits, offset + edits + 1));
  }

  return Option.none();
};

/** How many times each line occurs in `lines`. */
const countsOf = (lines: readonly string[]) => {
  const counts = new Map<string, number>();

  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  return counts;
};

/**
 * A script for a rewrite too large for the shortest: the lines found once
 * in each file are kept, in order, each matched after the last; every other
 * line is deleted or inserted.
 */
const anchored = (
  previous: readonly string[],
  next: readonly string[]
): readonly Step[] => {
  const before = countsOf(previous);
  const after = countsOf(next);

  const unique = (line: string) =>
    before.get(line) === 1 && after.get(line) === 1;

  const where = new Map<string, number>(
    previous.flatMap((line, index) =>
      unique(line) ? [[line, index] as const] : []
    )
  );

  const steps: Step[] = [];
  let cursor = 0;

  for (const line of next) {
    const found = where.get(line) ?? -1;

    if (found < cursor) {
      steps.push("Insert");
    } else {
      for (; cursor < found; cursor += 1) {
        steps.push("Delete");
      }

      steps.push("Equal");
      cursor += 1;
    }
  }

  for (; cursor < previous.length; cursor += 1) {
    steps.push("Delete");
  }

  return steps;
};

/** The steps of a script, as runs: in each run of changes, deletions first. */
const runsOf = (steps: readonly Step[]): readonly Edit[] => {
  const edits: Edit[] = [];
  let oldStart = 0;
  let newStart = 0;
  let index = 0;

  while (index < steps.length) {
    let count = 0;

    if (steps[index] === "Equal") {
      for (; steps[index] === "Equal"; index += 1) {
        count += 1;
      }

      edits.push(Edit.Equal({ count, newStart, oldStart }));
      oldStart += count;
      newStart += count;
    } else {
      let deleted = 0;
      let inserted = 0;

      for (
        let step = steps[index];
        step !== undefined && step !== "Equal";
        step = steps[index]
      ) {
        if (step === "Delete") {
          deleted += 1;
        } else {
          inserted += 1;
        }

        index += 1;
      }

      if (deleted > 0) {
        edits.push(Edit.Delete({ count: deleted, newStart, oldStart }));
        oldStart += deleted;
      }

      if (inserted > 0) {
        edits.push(Edit.Insert({ count: inserted, newStart, oldStart }));
        newStart += inserted;
      }
    }
  }

  return edits;
};

/** How many lines from each end `previous` and `next` share. */
export const sharedEnds = (
  previous: readonly string[],
  next: readonly string[]
) => {
  let head = 0;

  while (
    head < previous.length &&
    head < next.length &&
    previous[head] === next[head]
  ) {
    head += 1;
  }

  let tail = 0;

  while (
    tail < previous.length - head &&
    tail < next.length - head &&
    previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1;
  }

  return { head, tail };
};

/** `middle` with the shared head and tail around it. */
const framed = (
  ends: { readonly head: number; readonly tail: number },
  middle: readonly Step[]
): readonly Step[] => [
  ...Array.from({ length: ends.head }, (): Step => "Equal"),
  ...middle,
  ...Array.from({ length: ends.tail }, (): Step => "Equal"),
];

/**
 * A shortest edit script from `before` to `after`, or none when it takes
 * more than `MAX_EDITS` edits past the shared head and tail.
 */
export const shortestDiff = (
  before: readonly string[],
  after: readonly string[]
): Option.Option<readonly Edit[]> => {
  const ends = sharedEnds(before, after);

  return Option.map(
    myers(
      before.slice(ends.head, before.length - ends.tail),
      after.slice(ends.head, after.length - ends.tail)
    ),
    (middle) => runsOf(framed(ends, middle))
  );
};

/**
 * The edit script from `before` to `after`: the shortest, or, for a rewrite
 * past `MAX_EDITS` edits, one that keeps the lines found once in each file.
 */
export const lineDiff = (
  before: readonly string[],
  after: readonly string[]
): readonly Edit[] =>
  Option.getOrElse(shortestDiff(before, after), () => {
    const ends = sharedEnds(before, after);

    return runsOf(
      framed(
        ends,
        anchored(
          before.slice(ends.head, before.length - ends.tail),
          after.slice(ends.head, after.length - ends.tail)
        )
      )
    );
  });
