import { File } from "@pierre/diffs/react";
import type { FileOptions } from "@pierre/diffs/react";
import { useMemo } from "react";

import { diffsOptions, registerCodeTheme } from "../code/pierre.ts";
import { CodePool } from "../code/pool.tsx";

registerCodeTheme();

export interface DraftedFileProps {
  readonly path: string;
  readonly content: string;
}

const options: FileOptions<undefined, undefined> = {
  ...diffsOptions,
  disableFileHeader: true,
  overflow: "scroll",
};

export const DraftedFile = ({ content, path }: DraftedFileProps) => {
  const file = useMemo(
    () => ({ contents: content, name: path }),
    [content, path]
  );

  return (
    <CodePool>
      <div className="border-rule min-w-0 border" data-code="pierre">
        <File file={file} options={options} />
      </div>
    </CodePool>
  );
};

// `React.lazy` takes a module's default export.
export default DraftedFile;
