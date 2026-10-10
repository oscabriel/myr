/**
 * The file drawn by `@pierre/diffs`, with a band above each group of lines
 * one commit brought (`WhyBand`, the same the server's plain lines carry):
 * an annotation renders after its `lineNumber`, so a group starting at
 * line `n` sits at `n - 1`, and `0` is above line 1. Highlighting runs in
 * the worker pool. Clicking a line number opens a dialog with that line's
 * landing whole.
 *
 * It is Pierre's `File` (as `code-view.tsx` draws a file), which renders
 * on the server too, so its markup can be checked; the page loads it only
 * in the browser (`client-why.tsx`), and the Worker never bundles it.
 */
import { File } from "@pierre/diffs/react";
import type { FileOptions, LineAnnotation } from "@pierre/diffs/react";
import type { WhyView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import type { DateTime } from "effect";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { shortSha } from "../code/paths.ts";
import { diffsOptions, registerCodeTheme } from "../code/pierre.ts";
import { CodePool } from "../code/pool.tsx";
import { BandLinks, LandingDetails, WhyBand } from "./range-summary.tsx";
import { groupsOf, linesWords, rowAt, rowsOf } from "./rows.ts";
import type { WhyRow } from "./rows.ts";

registerCodeTheme();

export interface WhyCodeProps {
  readonly now: DateTime.Utc;
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
          Who put this line there, and the landing whole.
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
      <BandLinks project={project} row={row} view={view} />
    </DialogContent>
  </Dialog>
);

export const WhyCode = ({ now, project, text, view }: WhyCodeProps) => {
  const [line, setLine] = useState<number | null>(null);
  const rows = useMemo(() => rowsOf(view), [view]);
  const groups = useMemo(() => groupsOf(view), [view]);

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
      groups.map((row) => ({ lineNumber: row.range.start - 1, metadata: row })),
    [groups]
  );

  const options = useMemo(
    (): FileOptions<WhyRow, undefined> => ({
      ...diffsOptions,
      disableFileHeader: true,
      lineHoverHighlight: "number",
      onLineNumberClick: ({ lineNumber }) => {
        setLine(lineNumber);
      },
      overflow: "scroll",
    }),
    []
  );

  const clicked = line === null ? Option.none() : rowAt(rows, line);

  return (
    <CodePool>
      <div className="min-w-0" data-code="pierre" data-why="ranges">
        <File
          file={file}
          lineAnnotations={annotations}
          options={options}
          renderAnnotation={({ metadata }) => (
            <WhyBand now={now} project={project} row={metadata} view={view} />
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
    </CodePool>
  );
};

// `React.lazy` takes a module's default export.
export default WhyCode;
