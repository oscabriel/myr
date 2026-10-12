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

export type Part = "territory" | "tests" | "other";

export interface PatchFile extends DrawnFile {
  readonly part: Part;
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

const isBinary = (block: string) =>
  /^(?:Binary files .* differ|GIT binary patch)$/mu.test(block);

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

export interface PatchLine {
  readonly kind: "addition" | "context" | "deletion";
  readonly number: number;
  readonly text: string;
}

export type PatchRow =
  | { readonly kind: "separator"; readonly lines: number }
  | PatchLine;

const bare = (line: string | undefined) => (line ?? "").replace(/\r?\n$/u, "");

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

export const drawnLines = (diff: FileDiffMetadata): ReadonlySet<number> =>
  new Set(
    patchRows(diff).flatMap((row) =>
      row.kind === "addition" || row.kind === "context" ? [row.number] : []
    )
  );
