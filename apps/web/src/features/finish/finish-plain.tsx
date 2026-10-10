/**
 * A decider's diff as plain text: what the server sends, and what a reader
 * sees until the browser has drawn the highlighted diff over it (or, on a
 * phone, the one file being read). It takes the code browser's measures
 * (a 44 px sticky file header, 13 px code on 20 px lines, the gutter, the
 * sign column, the diff's own tints), so the drawing arrives in place.
 *
 * Under a line it draws what the page puts there (a refusal that pointed
 * at it, a marker waiting on a decision); a note whose line the diff does
 * not show sits at the top of its file, saying which line it means.
 */
import { Option } from "effect";
import type { ReactNode } from "react";

import { diffAnchor } from "../code/paths.ts";
import { FileHeaderLine } from "../code/plain-diff.tsx";
import { drawnLines, patchRows } from "./files.ts";
import type { PatchFile, PatchLine } from "./files.ts";
import { MarkRead } from "./mark-read.tsx";
import type { MarkedFile } from "./read-marks.ts";

/** Something drawn under one line of one file. */
export interface LineNote {
  readonly path: string;
  readonly line: number;
  readonly node: ReactNode;
}

const TONES = {
  addition: {
    line: "bg-diff-add-bg",
    number: "bg-diff-add-bg text-diff-add-sign",
  },
  context: { line: "", number: "text-muted-foreground" },
  deletion: {
    line: "bg-diff-del-bg",
    number: "bg-diff-del-bg text-diff-del-sign",
  },
} as const satisfies Record<
  PatchLine["kind"],
  { readonly line: string; readonly number: string }
>;

const SIGNS = { addition: "+", context: " ", deletion: "-" } as const;

const GUTTER =
  "border-background min-w-[calc(6ch+2px)] border-r-2 pr-[1ch] pl-[2ch] text-right tabular-nums select-none";

/** The notes on one file: under a line it draws, and those it does not. */
const notesFor = (file: PatchFile, notes: readonly LineNote[]) => {
  const mine = notes.filter(({ path }) => path === file.file.path);

  const shown = Option.match(file.diff, {
    onNone: () => new Set<number>(),
    onSome: drawnLines,
  });

  return {
    at: (line: number) =>
      mine.filter((note) => note.line === line && shown.has(line)),
    elsewhere: mine.filter(({ line }) => !shown.has(line)),
  };
};

/** One file's lines, with its notes under theirs. */
const Lines = ({
  file,
  notes,
}: {
  readonly file: PatchFile;
  readonly notes: ReturnType<typeof notesFor>;
}) =>
  Option.match(file.diff, {
    onNone: () => (
      <p className="text-ui text-muted-foreground px-4 pb-3 font-sans">
        {file.file.binary ? "A binary file" : "No lines changed"},{" "}
        {file.file.status}.
      </p>
    ),
    onSome: (diff) => (
      <div className="overflow-x-auto pb-2">
        <code className="grid min-w-full grid-cols-[min-content_1fr]">
          {patchRows(diff).map((row, index) =>
            row.kind === "separator" ? (
              <div
                className="bg-surface text-muted-foreground col-span-2 my-2 flex h-8 items-center px-[2ch] font-sans first:mt-0"
                data-separator="line-info"
                key={`s${index}`}
              >
                {row.lines} unmodified {row.lines === 1 ? "line" : "lines"}
              </div>
            ) : (
              <span
                className="contents"
                key={`${row.kind}${row.number}:${index}`}
              >
                <span className={`${GUTTER} ${TONES[row.kind].number}`}>
                  {row.number}
                </span>
                <span
                  className={`pr-[1ch] whitespace-pre ${TONES[row.kind].line}`}
                  data-line={row.number}
                  data-line-type={row.kind}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block w-[2ch] select-none"
                  >
                    {SIGNS[row.kind]}
                  </span>
                  {row.text}
                </span>
                {row.kind === "deletion"
                  ? null
                  : notes.at(row.number).map((note) => (
                      <div
                        className="col-span-2 whitespace-normal"
                        data-note-line={note.line}
                        key={`${note.path}:${note.line}`}
                      >
                        {note.node}
                      </div>
                    ))}
              </span>
            )
          )}
        </code>
      </div>
    ),
  });

export const FinishPlainDiff = ({
  files,
  folded,
  notes,
  onFold,
  onMark,
  read,
  refused,
}: {
  readonly files: readonly PatchFile[];
  readonly notes: readonly LineNote[];
  /** The files this reader marked read; each header offers "Mark read" when given. */
  readonly read?: ReadonlySet<string> | undefined;
  readonly onMark?: ((file: MarkedFile, read: boolean) => void) | undefined;
  /** The files a refusal points into, marked in their headers. */
  readonly refused?: ReadonlySet<string> | undefined;
  readonly folded?: ReadonlySet<string> | undefined;
  readonly onFold?: ((path: string, folded: boolean) => void) | undefined;
}) => (
  <div className="text-mono leading-code font-mono" data-diff="plain">
    {files.map((file) => {
      const { path } = file.file;
      const closed = folded === undefined ? file.folded : folded.has(path);
      const mine = notesFor(file, notes);

      return (
        <section
          aria-label={path}
          data-file={path}
          data-folded={closed}
          data-part={file.part}
          data-refused={refused?.has(path) === true ? "" : undefined}
          id={diffAnchor(path)}
          key={path}
        >
          <details
            className="group/file"
            onToggle={(event) => {
              onFold?.(path, !event.currentTarget.open);
            }}
            open={!closed}
          >
            <summary
              className="border-rule bg-background text-mono hover:bg-surface sticky top-0 z-[1] flex h-11 cursor-pointer list-none items-center gap-2 border-y px-4 font-sans [&::-webkit-details-marker]:hidden"
              data-diffs-header=""
            >
              <FileHeaderLine
                end={
                  read === undefined ? undefined : (
                    <MarkRead
                      file={file}
                      onMark={onMark}
                      read={read.has(path)}
                    />
                  )
                }
                file={file}
              />
            </summary>
            {mine.elsewhere.map((note) => (
              <div
                className="font-sans"
                data-note-line={note.line}
                key={`${note.path}:${note.line}:elsewhere`}
              >
                <p className="text-label text-muted-foreground px-4 pt-2 font-normal">
                  At line {note.line}, outside the lines this diff shows:
                </p>
                {note.node}
              </div>
            ))}
            <Lines file={file} notes={mine} />
          </details>
        </section>
      );
    })}
  </div>
);
