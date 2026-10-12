import { describe, expect, it } from "@effect/vitest";

import { Edit, lineDiff } from "../src/line-diff.ts";

const lines = (text: string) => (text === "" ? [] : text.split(" "));

const apply = (
  before: readonly string[],
  after: readonly string[],
  edits: readonly Edit[]
) => {
  const out: string[] = [];
  let old = 0;

  for (const edit of edits) {
    expect(edit.oldStart).toBe(old);
    expect(edit.newStart).toBe(out.length);

    if (Edit.$is("Insert")(edit)) {
      out.push(...after.slice(edit.newStart, edit.newStart + edit.count));
    } else {
      if (Edit.$is("Equal")(edit)) {
        out.push(...before.slice(old, old + edit.count));
      }

      old += edit.count;
    }
  }

  expect(old).toBe(before.length);

  return out;
};

const runs = (edits: readonly Edit[]) =>
  edits.map(({ _tag, count }) => [_tag, count] as const);

describe("the line diff", () => {
  it("turns `a b c` into `a x c` as equal, delete, insert, equal", () => {
    expect(lineDiff(lines("a b c"), lines("a x c"))).toStrictEqual([
      Edit.Equal({ count: 1, newStart: 0, oldStart: 0 }),
      Edit.Delete({ count: 1, newStart: 1, oldStart: 1 }),
      Edit.Insert({ count: 1, newStart: 1, oldStart: 2 }),
      Edit.Equal({ count: 1, newStart: 2, oldStart: 2 }),
    ]);
  });

  it("rebuilds the new lines when its script is applied to the old", () => {
    const pairs = [
      ["a b c", "a x c"],
      ["", "a b"],
      ["a b", ""],
      ["a b c d e f", "x a c d y f z"],
      ["one two three four", "one between two three FOUR five"],
      ["a a a b", "b a a a"],
    ] as const;

    for (const [from, to] of pairs) {
      const before = lines(from);
      const after = lines(to);

      expect(apply(before, after, lineDiff(before, after))).toStrictEqual(
        after
      );
    }
  });

  it("is one equal run for the same lines, and none for two empty files", () => {
    expect(runs(lineDiff(lines("a b"), lines("a b")))).toStrictEqual([
      ["Equal", 2],
    ]);
    expect(lineDiff([], [])).toStrictEqual([]);
  });

  it("keeps the lines a rewrite past the shortest search shares, in order", () => {
    const before = Array.from({ length: 3000 }, (_, at) => `old ${at}`);

    const after = Array.from({ length: 3000 }, (_, at) =>
      at % 100 === 0 ? `old ${at}` : `new ${at}`
    );

    const edits = lineDiff(before, after);

    expect(apply(before, after, edits)).toStrictEqual(after);
    expect(
      edits.filter(Edit.$is("Equal")).reduce((sum, { count }) => sum + count, 0)
    ).toBe(30);
  });
});
