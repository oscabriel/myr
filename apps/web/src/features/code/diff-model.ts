/**
 * A commit's changed files as the diff draws them, worked out once by the
 * same parser the drawing uses (`@pierre/diffs`' `parseDiffFromFile`), so
 * the server's plain-text diff and the highlighted one the browser draws
 * over it hold the same hunks, line for line: the swap moves nothing.
 *
 * Also here: each file's `+n −m`, which files start folded (an added or
 * deleted file past `LONG_FILE` lines), the order a tree lists paths in,
 * and a commit's stats split by path (the ask's territory, its tests, the
 * rest), counted by rule, never by a model.
 *
 * No React and no DOM: the server's render and the browser's both read it.
 */
import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { Option } from "effect";

/** Past this many lines an added or deleted file starts folded. */
export const LONG_FILE = 80;

/** A file's diff, parsed from both its texts; none for a binary or unsent file. */
export const fileDiffOf = (
  file: ChangedFile
): Option.Option<FileDiffMetadata> => {
  if (
    file.binary ||
    (file.oldText === undefined && file.newText === undefined)
  ) {
    return Option.none();
  }

  const before =
    file.status === "added" || file.oldText === undefined
      ? null
      : { contents: file.oldText, name: file.path };

  const after =
    file.status === "deleted" || file.newText === undefined
      ? null
      : { contents: file.newText, name: file.path };

  const diff = parseDiffFromFile(before, after);

  // Keyed by both blobs, so a file drawn once is never highlighted again.
  diff.cacheKey = `diff:${file.before ?? "none"}:${file.after ?? "none"}`;

  return Option.some(diff);
};

/** Each kind of change as the drawing names it. */
const CHANGE_TYPES = {
  added: "new",
  deleted: "deleted",
  modified: "change",
} as const satisfies Record<ChangedFile["status"], FileDiffMetadata["type"]>;

/** A diff with no lines: a header alone, for a file whose lines are not shown. */
export const emptyDiffOf = (file: ChangedFile): FileDiffMetadata => ({
  additionLines: [],
  cacheKey: `diff:${file.before ?? "none"}:${file.after ?? "none"}`,
  deletionLines: [],
  hunks: [],
  isPartial: false,
  name: file.path,
  splitLineCount: 0,
  type: CHANGE_TYPES[file.status],
  unifiedLineCount: 0,
});

/** Lines a file's diff adds and removes. */
export interface Counts {
  readonly additions: number;
  readonly deletions: number;
}

const NONE: Counts = { additions: 0, deletions: 0 };

/** What `diff` adds and removes, line by line. */
export const countsOf = (diff: Option.Option<FileDiffMetadata>): Counts => {
  if (Option.isNone(diff)) {
    return NONE;
  }

  let additions = 0;
  let deletions = 0;

  for (const hunk of diff.value.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }

  return { additions, deletions };
};

/** A changed file with its parsed diff and counts. */
export interface DrawnFile {
  readonly file: ChangedFile;
  readonly diff: Option.Option<FileDiffMetadata>;
  readonly counts: Counts;
  /** Whether it starts folded: added or deleted, past `LONG_FILE` lines. */
  readonly folded: boolean;
}

/**
 * The order a file tree lists paths in: segment by segment, a folder
 * before a file at the same level, then by name.
 */
export const treeOrder = (left: string, right: string) => {
  const a = left.split("/");
  const b = right.split("/");

  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index] ?? "";
    const y = b[index] ?? "";

    if (x !== y) {
      const xFolder = index < a.length - 1;
      const yFolder = index < b.length - 1;

      if (xFolder !== yFolder) {
        return xFolder ? -1 : 1;
      }

      return x.localeCompare(y, "en");
    }
  }

  return a.length - b.length;
};

/** `files` in tree order, each parsed and counted. */
export const drawnFiles = (
  files: readonly ChangedFile[]
): readonly DrawnFile[] =>
  files
    .toSorted((a, b) => treeOrder(a.path, b.path))
    .map((file) => {
      const diff = fileDiffOf(file);
      const counts = countsOf(diff);

      return {
        counts,
        diff,
        file,
        folded:
          file.status !== "modified" &&
          counts.additions + counts.deletions > LONG_FILE,
      };
    });

/** A test file, by its path: a test folder, or a `.test.` or `.spec.` name. */
export const isTestPath = (path: string) =>
  /(?:^|\/)(?:tests?|__tests__|spec)\//u.test(path) ||
  /\.(?:test|spec)\.[^/]+$/u.test(path);

/** A territory glob (`src/format/**`, `src/*.ts`) as a test on a path. */
export const globTest = (glob: string): ((path: string) => boolean) => {
  const pattern = glob
    .replaceAll(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**/", "\u0000")
    .replaceAll("**", "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\u0000", "(?:.*/)?")
    .replaceAll("\u0001", ".*");

  // A folder named without a pattern covers what is inside it.
  const whole = new RegExp(`^${pattern}(?:/.*)?$`, "u");

  return (path) => whole.test(path);
};

/** One part of a commit's stats: what its paths add and remove. */
export interface StatsPart extends Counts {
  readonly label: "other" | "territory" | "tests";
  readonly files: number;
}

/** A commit's stats: files, lines added and removed, and the parts by path. */
export interface DiffStats extends Counts {
  readonly files: number;
  readonly parts: readonly StatsPart[];
}

/**
 * The stats of `files`. With the ask's territory, a path it covers is the
 * territory's, a test file the tests', anything else the rest; without
 * one, a test file is the tests' and the rest is the rest. Empty parts are
 * left out.
 */
export const statsOf = (
  files: readonly DrawnFile[],
  territory: readonly string[] = []
): DiffStats => {
  const inTerritory = territory.map(globTest);

  const labelOf = (path: string): StatsPart["label"] => {
    if (isTestPath(path)) {
      return "tests";
    }

    return inTerritory.some((test) => test(path)) ? "territory" : "other";
  };

  const parts = (["territory", "tests", "other"] as const).flatMap(
    (label): readonly StatsPart[] => {
      const mine = files.filter(({ file }) => labelOf(file.path) === label);

      return mine.length === 0
        ? []
        : [
            {
              additions: mine.reduce(
                (sum, { counts }) => sum + counts.additions,
                0
              ),
              deletions: mine.reduce(
                (sum, { counts }) => sum + counts.deletions,
                0
              ),
              files: mine.length,
              label,
            },
          ];
    }
  );

  return {
    additions: parts.reduce((sum, part) => sum + part.additions, 0),
    deletions: parts.reduce((sum, part) => sum + part.deletions, 0),
    files: files.length,
    parts,
  };
};

/** One row of a plain diff, as unified or split draws it. */
export type PlainRow =
  | { readonly kind: "separator"; readonly lines: number }
  | {
      readonly kind: "context" | "addition" | "deletion";
      readonly number: number;
      readonly text: string;
    };

/** A line as the diff stores it, without its line ending. */
const bare = (line: string | undefined) => (line ?? "").replace(/\r?\n$/u, "");

/**
 * `diff` as unified rows: before each hunk the unchanged lines it skips
 * as one separator, then its lines (deletions before additions in a
 * change, each numbered on its own side), and after the last hunk the
 * unchanged lines left.
 */
export const unifiedRows = (diff: FileDiffMetadata): readonly PlainRow[] => {
  const rows: PlainRow[] = [];
  let lastAddition = 0;

  for (const hunk of diff.hunks) {
    if (hunk.collapsedBefore > 0) {
      rows.push({ kind: "separator", lines: hunk.collapsedBefore });
    }

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let line = 0; line < content.lines; line += 1) {
          const index = content.additionLineIndex + line;

          rows.push({
            kind: "context",
            number: index + 1,
            text: bare(diff.additionLines[index]),
          });
        }
      } else {
        for (let line = 0; line < content.deletions; line += 1) {
          const index = content.deletionLineIndex + line;

          rows.push({
            kind: "deletion",
            number: index + 1,
            text: bare(diff.deletionLines[index]),
          });
        }

        for (let line = 0; line < content.additions; line += 1) {
          const index = content.additionLineIndex + line;

          rows.push({
            kind: "addition",
            number: index + 1,
            text: bare(diff.additionLines[index]),
          });
        }
      }
    }

    lastAddition = hunk.additionStart - 1 + hunk.additionCount;
  }

  const after = diff.isPartial ? 0 : diff.additionLines.length - lastAddition;

  if (diff.hunks.length > 0 && after > 0 && diff.type !== "deleted") {
    rows.push({ kind: "separator", lines: after });
  }

  return rows;
};

/** One numbered line of a plain diff. */
type Line = Extract<PlainRow, { readonly number: number }>;

/** One row of a split diff: the old side and the new, either empty. */
export type SplitRow =
  | { readonly kind: "separator"; readonly lines: number }
  | {
      readonly kind: "pair";
      readonly left?: Line;
      readonly right?: Line;
    };

/**
 * `diff` as split rows: a context line on both sides, and in a change the
 * deletions beside the additions, row for row, the longer side's rest
 * against nothing.
 */
export const splitRows = (diff: FileDiffMetadata): readonly SplitRow[] => {
  const rows: SplitRow[] = [];
  let lastAddition = 0;

  for (const hunk of diff.hunks) {
    if (hunk.collapsedBefore > 0) {
      rows.push({ kind: "separator", lines: hunk.collapsedBefore });
    }

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let line = 0; line < content.lines; line += 1) {
          const old = content.deletionLineIndex + line;
          const index = content.additionLineIndex + line;

          rows.push({
            kind: "pair",
            left: {
              kind: "context",
              number: old + 1,
              text: bare(diff.deletionLines[old]),
            },
            right: {
              kind: "context",
              number: index + 1,
              text: bare(diff.additionLines[index]),
            },
          });
        }
      } else {
        const span = Math.max(content.deletions, content.additions);

        for (let line = 0; line < span; line += 1) {
          const old = content.deletionLineIndex + line;
          const index = content.additionLineIndex + line;

          const left: Line = {
            kind: "deletion",
            number: old + 1,
            text: bare(diff.deletionLines[old]),
          };

          const right: Line = {
            kind: "addition",
            number: index + 1,
            text: bare(diff.additionLines[index]),
          };

          if (line < content.deletions && line < content.additions) {
            rows.push({ kind: "pair", left, right });
          } else if (line < content.deletions) {
            rows.push({ kind: "pair", left });
          } else {
            rows.push({ kind: "pair", right });
          }
        }
      }
    }

    lastAddition = hunk.additionStart - 1 + hunk.additionCount;
  }

  const after = diff.isPartial ? 0 : diff.additionLines.length - lastAddition;

  if (diff.hunks.length > 0 && after > 0 && diff.type !== "deleted") {
    rows.push({ kind: "separator", lines: after });
  }

  return rows;
};
