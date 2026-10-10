/**
 * A changed file's "Mark read" button, in its header: the word in sight
 * (never an icon alone), pressed once read, and the file's path for a
 * screen reader. A mark is this reader's alone (`read-marks.ts`).
 */
import { Check } from "lucide-react";

import type { PatchFile } from "./files.ts";
import type { MarkedFile } from "./read-marks.ts";

/** A file's "Mark read" button: its word in sight, and what it marks for a screen reader. */
export const MarkRead = ({
  file,
  onMark,
  read,
}: {
  readonly file: PatchFile;
  readonly read: boolean;
  readonly onMark?: ((file: MarkedFile, read: boolean) => void) | undefined;
}) => (
  <button
    aria-pressed={read}
    className={`text-label hover:bg-surface border-input ml-1 inline-flex h-7 shrink-0 items-center gap-1.5 border px-2 font-sans transition-colors duration-[120ms] ${read ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    data-mark-read={file.file.path}
    onClick={(event) => {
      // The header folds its file on a press; this press only marks it.
      event.preventDefault();
      event.stopPropagation();
      onMark?.({ patchId: file.patchId, path: file.file.path }, !read);
    }}
    type="button"
  >
    {read ? (
      <Check aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
    ) : null}
    {read ? "Read" : "Mark read"}
    <span className="sr-only"> {file.file.path}</span>
  </button>
);
