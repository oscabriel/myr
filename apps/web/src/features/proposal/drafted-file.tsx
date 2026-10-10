/**
 * One drafted file, drawn by `@pierre/diffs`: the ask file or its check,
 * highlighted by Shiki's JavaScript engine (never its WASM one). Nothing is
 * selectable or anchored here: a page may hold several of these, and the
 * file's own page is the place for `#L` anchors.
 *
 * The library and Shiki's grammars are megabytes, so only the browser
 * loads this module (`client-file.tsx`); the Worker never bundles it.
 */
import { File } from "@pierre/diffs/react";
import type { FileOptions } from "@pierre/diffs/react";
import { useMemo } from "react";

import { diffsOptions, registerCodeTheme } from "../code/pierre.ts";

registerCodeTheme();

export interface DraftedFileProps {
  readonly path: string;
  readonly content: string;
}

const options: FileOptions<undefined, undefined> = {
  ...diffsOptions,
  // The page names the file in its own heading above the code.
  disableFileHeader: true,
  overflow: "scroll",
};

export const DraftedFile = ({ content, path }: DraftedFileProps) => {
  const file = useMemo(
    () => ({ contents: content, name: path }),
    [content, path]
  );

  return (
    <div className="border-rule min-w-0 border" data-code="pierre">
      <File file={file} options={options} />
    </div>
  );
};

// `React.lazy` takes a module's default export.
export default DraftedFile;
