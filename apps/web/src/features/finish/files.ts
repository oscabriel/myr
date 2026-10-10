/**
 * The files a decision's diff changes, as its page draws them: parsed once
 * by the drawing's own parser (`@pierre/diffs`' `parsePatchFiles`), so the
 * server's plain text and the browser's drawing hold the same hunks; each
 * file's `+n −m`, its id for the read marks, and its part of the change.
 *
 * The order is a rule, never a model's: the ask's territory first, then
 * tests, then anything else, each part by path in the order a tree lists
 * them.
 *
 * A diff's lines are numbered from its hunk headers (a patch holds only
 * the hunks, not the whole files), so a refusal's `at` line finds the line
 * it names.
 *
 * No React and no DOM: the server's render and the browser's both read it.
 */
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { RepoPath } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import {
  countsOf,
  globTest,
  isTestPath,
  LONG_FILE,
  treeOrder,
} from "../code/diff-model.ts";
import type { DrawnFile } from "../code/diff-model.ts";
import { fileBlocks, patchIdOf } from "./patch.ts";

/** Which part of the change a file is in. */
export type Part = "territory" | "tests" | "other";

/** A changed file as the finish page holds it. */
export interface PatchFile extends DrawnFile {
  readonly part: Part;
  /** This file's change, as an id: what a read mark is kept against. */
  readonly patchId: string;
}

const STATUS = {
  change: "modified",
  deleted: "deleted",
  new: "added",
  "rename-changed": "modified",
  "rename-pure": "modified",
} as const satisfies Record<FileDiffMetadata["type"], ChangedFile["status"]>;

const PART_ORDER = {
  other: 2,
  territory: 0,
  tests: 1,
} as const satisfies Record<Part, number>;

const decodePath = Schema.decodeUnknownOption(RepoPath);

/** The part a path is in: the territory's, the tests', or the rest. */
export const partOf =
  (territory: readonly string[]) =>
  (path: string): Part => {
    if (isTestPath(path)) {
      return "tests";
    }

    return territory.some((glob) => globTest(glob)(path))
      ? "territory"
      : "other";
  };

/** Whether a file's block holds no text lines to draw: git's binary notes. */
const isBinary = (block: string) =>
  /^(?:Binary files .* differ|GIT binary patch)$/mu.test(block);

/**
 * The files `patch` changes, parsed and counted, territory first, then
 * tests, then the rest. `key` names the change, so the drawing caches each
 * file's highlighting once.
 */
export const patchFiles = (
  patch: string,
  territory: readonly string[],
  key: string
): readonly PatchFile[] => {
  const blocks = fileBlocks(patch);
  const part = partOf(territory);

  const parsed = parsePatchFiles(patch).flatMap(({ files }) => files);

  return parsed
    .flatMap((diff): readonly PatchFile[] => {
      const path = decodePath(diff.name);

      if (Option.isNone(path)) {
        return [];
      }

      const block = blocks.get(diff.name) ?? "";
      const binary = isBinary(block);
      const patchId = patchIdOf(block);

      diff.cacheKey = `finish:${key}:${diff.name}:${patchId}`;

      const shown = binary ? Option.none() : Option.some(diff);
      const counts = countsOf(shown);
      const status = STATUS[diff.type];

      return [
        {
          counts,
          diff: shown,
          file: { binary, path: path.value, status },
          folded:
            status !== "modified" &&
            counts.additions + counts.deletions > LONG_FILE,
          part: part(diff.name),
          patchId,
        },
      ];
    })
    .toSorted(
      (a, b) =>
        PART_ORDER[a.part] - PART_ORDER[b.part] ||
        treeOrder(a.file.path, b.file.path)
    );
};

/** One numbered line of a patch, on its side. */
export interface PatchLine {
  readonly kind: "addition" | "context" | "deletion";
  /** Its number in the new file (context and additions) or the old one (deletions). */
  readonly number: number;
  readonly text: string;
}

/** One row of a patch's unified view: a line, or the unchanged lines a hunk skips. */
export type PatchRow =
  | { readonly kind: "separator"; readonly lines: number }
  | PatchLine;

/** A line as the diff stores it, without its line ending. */
const bare = (line: string | undefined) => (line ?? "").replace(/\r?\n$/u, "");

/**
 * `diff` as unified rows, each line numbered from its hunk's header: a
 * context line and an addition by the new file, a deletion by the old.
 */
export const patchRows = (diff: FileDiffMetadata): readonly PatchRow[] => {
  const rows: PatchRow[] = [];

  for (const hunk of diff.hunks) {
    if (hunk.collapsedBefore > 0) {
      rows.push({ kind: "separator", lines: hunk.collapsedBefore });
    }

    let next = hunk.additionStart;
    let old = hunk.deletionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let line = 0; line < content.lines; line += 1) {
          rows.push({
            kind: "context",
            number: next,
            text: bare(diff.additionLines[content.additionLineIndex + line]),
          });
          next += 1;
          old += 1;
        }
      } else {
        for (let line = 0; line < content.deletions; line += 1) {
          rows.push({
            kind: "deletion",
            number: old,
            text: bare(diff.deletionLines[content.deletionLineIndex + line]),
          });
          old += 1;
        }

        for (let line = 0; line < content.additions; line += 1) {
          rows.push({
            kind: "addition",
            number: next,
            text: bare(diff.additionLines[content.additionLineIndex + line]),
          });
          next += 1;
        }
      }
    }
  }

  return rows;
};

/** The new file's line numbers a diff draws: where an annotation at a line can sit. */
export const drawnLines = (diff: FileDiffMetadata): ReadonlySet<number> =>
  new Set(
    patchRows(diff).flatMap((row) =>
      row.kind === "addition" || row.kind === "context" ? [row.number] : []
    )
  );
