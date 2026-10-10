/**
 * An answer's diff, drawn by `@pierre/diffs`: one stacked (unified) view per
 * changed file, its lines wrapped rather than scrolled sideways, so a phone
 * reads it at 360 px. The colours follow the system's light or dark setting,
 * as the rest of the site does.
 *
 * The library and Shiki's grammars are megabytes, so only the browser loads
 * this module (`client-diff.tsx`); the Worker never bundles it.
 */
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { FileDiffOptions } from "@pierre/diffs/react";
import { useMemo } from "react";

import { diffsOptions, registerCodeTheme } from "../code/pierre.ts";

registerCodeTheme();

const options = {
  ...diffsOptions,
  diffStyle: "unified",
  overflow: "wrap",
} as const satisfies FileDiffOptions<undefined, undefined>;

export const PatchDiffs = ({ patch }: { readonly patch: string }) => {
  const files = useMemo(
    () => parsePatchFiles(patch).flatMap((parsed) => parsed.files),
    [patch]
  );

  return (
    <div className="flex flex-col gap-4" data-diff="pierre">
      {files.map((file) => (
        <section
          aria-label={file.name}
          key={`${file.prevName ?? ""}:${file.name}`}
        >
          <FileDiff fileDiff={file} options={options} />
        </section>
      ))}
    </div>
  );
};

// `React.lazy` takes a module's default export.
export default PatchDiffs;
