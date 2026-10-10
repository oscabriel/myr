/**
 * A commit's changes, drawn by `@pierre/diffs`: one `MultiFileDiff` per
 * changed file, stacked, each from the file's old and new text, unified
 * unless `split`. (Pierre's virtualized `CodeView` draws nothing until it
 * mounts, so it cannot be seen rendered outside a browser; the stacked
 * views can, and a commit's diff is capped at 300 files.) A binary
 * file, or one whose text the platform did not send, says so in a line.
 * Each view's section is the file tree's jump target (`diffAnchor`).
 *
 * Only the browser loads this module (`client-code.tsx`).
 */
import { MultiFileDiff } from "@pierre/diffs/react";
import type { FileDiffOptions } from "@pierre/diffs/react";
import type { ChangedFile } from "@repo/protocol/domain/code";

import { diffAnchor } from "./paths.ts";
import { diffsOptions, registerCodeTheme } from "./pierre.ts";

registerCodeTheme();

const optionsFor = (split: boolean): FileDiffOptions<undefined, undefined> => ({
  ...diffsOptions,
  diffStyle: split ? "split" : "unified",
  overflow: "wrap",
});

export interface DiffCodeProps {
  readonly files: readonly ChangedFile[];
  readonly split: boolean;
}

/** Whether the platform sent the text of both sides it has. */
const drawable = (file: ChangedFile) =>
  !file.binary && (file.oldText !== undefined || file.newText !== undefined);

export const DiffCode = ({ files, split }: DiffCodeProps) => {
  const options = optionsFor(split);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-diff="pierre">
      {files.map((file) =>
        drawable(file) ? (
          <section
            aria-label={file.path}
            id={diffAnchor(file.path)}
            key={file.path}
          >
            <MultiFileDiff
              newFile={{ contents: file.newText ?? "", name: file.path }}
              oldFile={{ contents: file.oldText ?? "", name: file.path }}
              options={options}
            />
          </section>
        ) : (
          <section
            aria-label={file.path}
            className="border-rule text-mono border border-dashed px-4 py-3 font-mono"
            id={diffAnchor(file.path)}
            key={file.path}
          >
            {file.path}: {file.binary ? "a binary file" : "not shown"},{" "}
            {file.status}
          </section>
        )
      )}
    </div>
  );
};

// `React.lazy` takes a module's default export.
export default DiffCode;
