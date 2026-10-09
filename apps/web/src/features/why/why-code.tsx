/**
 * The file drawn by `@pierre/diffs`, with one annotation row above each
 * range of lines saying which landing (or adopted commit) brought it: an
 * annotation renders after its `lineNumber`, so a range starting at line
 * `n` sits at `n - 1`, and `0` is above line 1. Clicking a line number
 * opens a dialog with that line's landing whole.
 *
 * It is Pierre's `File` (as `code-view.tsx` draws a file), which renders
 * on the server too, so its markup can be checked; the page loads it only
 * in the browser (`client-why.tsx`), and the Worker never bundles it.
 */
import { DEFAULT_THEMES } from "@pierre/diffs";
import { File } from "@pierre/diffs/react";
import type { FileOptions, LineAnnotation } from "@pierre/diffs/react";
import type { WhyView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { shortSha } from "../code/paths.ts";
import { LandingDetails, RangeLinks, RangeSummary } from "./range-summary.tsx";
import { linesWords, rowAt, rowsOf } from "./rows.ts";
import type { WhyRow } from "./rows.ts";

/** Past this many characters a file is drawn without highlighting. */
const HIGHLIGHT_LIMIT = 300_000;

export interface WhyCodeProps {
  readonly project: ProjectName;
  /** The file's text at `view.at`. */
  readonly text: string;
  readonly view: WhyView;
}

/** The dialog for one clicked line: its landing, or the commit the project adopted. */
const LineDialog = ({
  line,
  onClose,
  project,
  row,
  view,
}: {
  readonly line: number;
  readonly onClose: () => void;
  readonly project: ProjectName;
  readonly row: WhyRow;
  readonly view: WhyView;
}) => (
  <Dialog
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
    open
  >
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          Line {line} ({linesWords(row.range)})
        </DialogTitle>
        <DialogDescription>
          <RangeSummary project={project} row={row} />
        </DialogDescription>
      </DialogHeader>
      {Option.isSome(row.landing) ? (
        <LandingDetails landing={row.landing.value} project={project} />
      ) : (
        <p className="text-sm">
          Commit {shortSha(row.range.sha)} came in with the history the project
          adopted, so no landing records who asked for it.
        </p>
      )}
      <RangeLinks line={line} project={project} row={row} view={view} />
    </DialogContent>
  </Dialog>
);

export const WhyCode = ({ project, text, view }: WhyCodeProps) => {
  const [line, setLine] = useState<number | null>(null);
  const rows = useMemo(() => rowsOf(view), [view]);

  const file = useMemo(
    () => ({
      cacheKey: `why:${view.at}:${view.path}`,
      contents: text,
      name: view.path,
    }),
    [text, view.at, view.path]
  );

  const annotations = useMemo(
    (): LineAnnotation<WhyRow>[] =>
      rows.map((row) => ({ lineNumber: row.range.start - 1, metadata: row })),
    [rows]
  );

  const options = useMemo(
    (): FileOptions<WhyRow, undefined> => ({
      lineHoverHighlight: "number",
      onLineNumberClick: ({ lineNumber }) => {
        setLine(lineNumber);
      },
      overflow: "scroll",
      preferredHighlighter: "shiki-js",
      theme: DEFAULT_THEMES,
      themeType: "system",
      tokenizeMaxLength: HIGHLIGHT_LIMIT,
    }),
    []
  );

  const clicked = line === null ? Option.none() : rowAt(rows, line);

  return (
    <div className="border-rule min-w-0 border" data-code="pierre">
      <File
        file={file}
        lineAnnotations={annotations}
        options={options}
        renderAnnotation={({ metadata }) => (
          <div
            className="border-rule bg-surface border-y px-3 py-1.5 text-xs"
            data-range={`${metadata.range.start}-${metadata.range.end}`}
          >
            <RangeSummary project={project} row={metadata} />
          </div>
        )}
      />
      {line === null || Option.isNone(clicked) ? null : (
        <LineDialog
          line={line}
          onClose={() => {
            setLine(null);
          }}
          project={project}
          row={clicked.value}
          view={view}
        />
      )}
    </div>
  );
};

// `React.lazy` takes a module's default export.
export default WhyCode;
