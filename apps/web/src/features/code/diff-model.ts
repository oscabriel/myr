/**
 * Parsed by the same parser the drawing uses, so the server's plain-text diff
 * and the browser's highlighted one hold the same hunks, line for line. No
 * React and no DOM: both renders read it.
 */
import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { Option } from "effect";

export const LONG_FILE = 80;

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

const CHANGE_TYPES = {
  added: "new",
  deleted: "deleted",
  modified: "change",
} as const satisfies Record<ChangedFile["status"], FileDiffMetadata["type"]>;

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

export interface Counts {
  readonly additions: number;
  readonly deletions: number;
}

const NONE: Counts = { additions: 0, deletions: 0 };

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

export interface DrawnFile {
  readonly file: ChangedFile;
  readonly diff: Option.Option<FileDiffMetadata>;
  readonly counts: Counts;
  readonly folded: boolean;
}

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

export const isTestPath = (path: string) =>
  /(?:^|\/)(?:tests?|__tests__|spec)\//u.test(path) ||
  /\.(?:test|spec)\.[^/]+$/u.test(path);

export const globTest = (glob: string): ((path: string) => boolean) => {
  const pattern = glob
    .replaceAll(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**/", "\u0000")
    .replaceAll("**", "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\u0000", "(?:.*/)?")
    .replaceAll("\u0001", ".*");

  const whole = new RegExp(`^${pattern}(?:/.*)?$`, "u");

  return (path) => whole.test(path);
};

export interface StatsPart extends Counts {
  readonly label: "other" | "territory" | "tests";
  readonly files: number;
}

export interface DiffStats extends Counts {
  readonly files: number;
  readonly parts: readonly StatsPart[];
}

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

export type PlainRow =
  | { readonly kind: "separator"; readonly lines: number }
  | {
      readonly kind: "context" | "addition" | "deletion";
      readonly number: number;
      readonly text: string;
    };

const bare = (line: string | undefined) => (line ?? "").replace(/\r?\n$/u, "");

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

type Line = Extract<PlainRow, { readonly number: number }>;

export type SplitRow =
  | { readonly kind: "separator"; readonly lines: number }
  | {
      readonly kind: "pair";
      readonly left?: Line;
      readonly right?: Line;
    };

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
