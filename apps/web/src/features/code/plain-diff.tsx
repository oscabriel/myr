/**
 * A commit's diff as plain text: what the server sends, and what a reader
 * sees until the browser has drawn the highlighted diff over it. It holds
 * the hunks the drawing holds (`diff-model.ts` parses both texts with the
 * drawing's own parser) and takes Pierre's measures: a 44 px file header,
 * 13 px code on 20 px lines, line numbers in a gutter of at least three
 * figures with two before and one after, a sign in the first of two
 * leading columns, unchanged runs as 32 px "N unmodified lines" bars. So
 * the highlighting arrives in place and nothing moves. The first files the
 * server highlights (`prerenderedPaths`, ADR 0027) are its drawing instead
 * of plain lines, under the same header.
 *
 * Each file is a disclosure whose summary is its header: folded, only the
 * header shows (an added or deleted file past 80 lines starts folded).
 * Additions and deletions take the diff's own tints, never the landed or
 * refused colour; a unified diff marks each line `+` or `-`, a split one
 * marks the side with a bar.
 */
import type { ChangedFile } from "@repo/protocol/domain/code";
import { Option } from "effect";
import { ChevronDown, SquareDot, SquareMinus, SquarePlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { drawnFiles, splitRows, unifiedRows } from "./diff-model.ts";
import type { DrawnFile, PlainRow, SplitRow } from "./diff-model.ts";
import { diffAnchor } from "./paths.ts";
import { diffDrawing } from "./prerender.ts";
import { ServerCode } from "./server-code.tsx";

/** One numbered line: its text, and which side it is on. */
type Line = Extract<PlainRow, { readonly number: number }>;

/** A line's ground and its number's colour, by what it is. */
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
  Line["kind"],
  { readonly line: string; readonly number: string }
>;

/** Each line's sign in a unified diff, the mark that reads without colour. */
const SIGNS = { addition: "+", context: " ", deletion: "-" } as const;

/** Pierre's gutter: at least three figures, two before them and one after, then a 2 px gap. */
const GUTTER =
  "border-background min-w-[calc(6ch+2px)] border-r-2 pr-[1ch] pl-[2ch] text-right tabular-nums select-none";

/** An unchanged run between hunks: a 32 px bar saying how many lines it skips. */
const Separator = ({
  lines,
  span,
}: {
  readonly lines: number;
  readonly span: number;
}) => (
  <div
    className="bg-surface text-muted-foreground my-2 flex h-8 items-center px-[2ch] font-sans first:mt-0 last:mb-0"
    data-separator="line-info"
    style={{ gridColumn: `span ${span} / span ${span}` }}
  >
    {lines} unmodified {lines === 1 ? "line" : "lines"}
  </div>
);

/** One line of a unified diff: its number, then its sign and text. */
const UnifiedLine = ({ line }: { readonly line: Line }) => (
  <>
    <span className={`${GUTTER} ${TONES[line.kind].number}`}>
      {line.number}
    </span>
    <span
      className={`pr-[1ch] whitespace-pre ${TONES[line.kind].line}`}
      data-line={line.number}
      data-line-type={line.kind}
    >
      <span aria-hidden="true" className="inline-block w-[2ch] select-none">
        {SIGNS[line.kind]}
      </span>
      {line.text}
    </span>
  </>
);

/** One side of a split diff's row: its number with the side's bar, then its text; empty when the side has none. */
const SplitSide = ({ line }: { readonly line: Line | undefined }) =>
  line === undefined ? (
    <>
      <span className={`${GUTTER} bg-surface`} />
      <span className="bg-surface" />
    </>
  ) : (
    <>
      <span
        className={`${GUTTER} relative ${TONES[line.kind].number} ${
          line.kind === "context"
            ? ""
            : `before:absolute before:inset-y-0 before:left-0 before:w-1 ${
                line.kind === "addition"
                  ? "before:bg-diff-add-sign"
                  : "before:bg-[repeating-linear-gradient(0deg,var(--diff-del-sign)_0_2px,transparent_2px_4px)]"
              }`
        }`}
      >
        {line.number}
      </span>
      <span
        className={`pr-[1ch] pl-[1ch] whitespace-pre ${TONES[line.kind].line}`}
        data-line={line.number}
        data-line-type={line.kind}
      >
        {line.text}
      </span>
    </>
  );

/** A file's lines, unified: one grid of gutter and code, scrolling sideways in itself. */
const UnifiedBody = ({ rows }: { readonly rows: readonly PlainRow[] }) => (
  <div className="overflow-x-auto pb-2">
    <code className="grid min-w-full grid-cols-[min-content_1fr]">
      {rows.map((row, index) =>
        row.kind === "separator" ? (
          <Separator key={`s${index}`} lines={row.lines} span={2} />
        ) : (
          <UnifiedLine key={`${row.kind}${row.number}:${index}`} line={row} />
        )
      )}
    </code>
  </div>
);

/** A file's lines, split: old on the left, new on the right, row beside row. */
const SplitBody = ({ rows }: { readonly rows: readonly SplitRow[] }) => (
  <div className="overflow-x-auto pb-2">
    <code className="grid min-w-full grid-cols-[min-content_1fr_min-content_1fr]">
      {rows.map((row, index) =>
        row.kind === "separator" ? (
          <Separator key={`s${index}`} lines={row.lines} span={4} />
        ) : (
          <span className="contents" key={`p${index}`}>
            <SplitSide line={row.left} />
            <SplitSide line={row.right} />
          </span>
        )
      )}
    </code>
  </div>
);

/** What a file changed, in counts: `+n −m`, each in its tint, with words for a screen reader. */
export const ChangeCounts = ({
  additions,
  deletions,
  header = false,
}: {
  readonly additions: number;
  readonly deletions: number;
  /** As a diff's file header prints them: a hyphen, and no count of nothing. */
  readonly header?: boolean;
}) => (
  <span className="text-mono flex shrink-0 items-center gap-[1ch] font-mono tabular-nums">
    {header && additions === 0 ? null : (
      <span className="text-diff-add-sign">
        +{additions}
        <span className="sr-only"> added</span>
      </span>
    )}
    {header && deletions === 0 ? null : (
      <span className="text-diff-del-sign">
        {header ? "-" : "−"}
        {deletions}
        <span className="sr-only"> removed</span>
      </span>
    )}
  </span>
);

/** Why a file has no lines to show: binary, or its text not sent. */
const Unshown = ({ file }: { readonly file: ChangedFile }) => (
  <p className="text-ui text-muted-foreground px-4 pb-3 font-sans">
    {file.binary ? "A binary file" : "Its text is not shown"}, {file.status}.
  </p>
);

/**
 * A file's lines, unified or split; why it has none when it has none. A
 * file the server highlighted (unified, `prerenderedPaths`) is its drawing,
 * and the plain lines only where the document did not bring it.
 */
const FileBody = ({
  file,
  prerendered,
  split,
}: {
  readonly file: DrawnFile;
  readonly prerendered: boolean;
  readonly split: boolean;
}) => {
  const diff = Option.getOrUndefined(file.diff);

  if (diff === undefined) {
    return <Unshown file={file.file} />;
  }

  if (split) {
    return <SplitBody rows={splitRows(diff)} />;
  }

  const plain = <UnifiedBody rows={unifiedRows(diff)} />;

  return prerendered ? (
    <div className="min-w-0" data-code="prerendered">
      <ServerCode drawing={() => diffDrawing(file)} plain={plain} />
    </div>
  ) : (
    plain
  );
};

/** Each kind of change as the drawing's header marks it, in the diff's tints. */
const CHANGE_MARKS = {
  added: { icon: SquarePlus, tone: "text-diff-add-sign" },
  deleted: { icon: SquareMinus, tone: "text-diff-del-sign" },
  modified: { icon: SquareDot, tone: "text-muted-foreground" },
} as const satisfies Record<
  ChangedFile["status"],
  { readonly icon: LucideIcon; readonly tone: string }
>;

/**
 * A file's header as the drawing draws it: the fold's chevron, the mark of
 * its change (with its word for a screen reader), its path, then its
 * counts and anything the page adds.
 */
export const FileHeaderLine = ({
  end,
  file,
}: {
  readonly file: DrawnFile;
  /** Anything a page puts at the header's end (a "Mark read" button). */
  readonly end?: ReactNode;
}) => {
  const { icon: Icon, tone } = CHANGE_MARKS[file.file.status];

  return (
    <>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0 -rotate-90 transition-transform duration-150 group-open/file:rotate-0"
        strokeWidth={1.75}
      />
      <Icon
        aria-hidden="true"
        className={`size-4 shrink-0 ${tone}`}
        strokeWidth={1.75}
      />
      <span className="sr-only">{file.file.status}:</span>
      <span className="min-w-0 flex-1 truncate" title={file.file.path}>
        {file.file.path}
      </span>
      {Option.isNone(file.diff) ? (
        <span className="text-muted-foreground shrink-0">
          {file.file.binary ? "binary" : "not shown"}
        </span>
      ) : (
        <ChangeCounts {...file.counts} header />
      )}
      {end}
    </>
  );
};

export interface PlainDiffProps {
  readonly files: readonly ChangedFile[];
  /** Old and new side by side; unified when absent. */
  readonly split?: boolean;
  /** The files folded now; each file's own default (`folded`) when absent. */
  readonly folded?: ReadonlySet<string> | undefined;
  /** A header's fold was pressed. */
  readonly onFold?: ((path: string, folded: boolean) => void) | undefined;
  /** `files` already parsed (`drawnFiles`), so a page parses each once. */
  readonly drawn?: readonly DrawnFile[] | undefined;
  /** The paths the server sends highlighted (`prerenderedPaths`); none when absent. */
  readonly prerendered?: ReadonlySet<string> | undefined;
}

/**
 * The diff of `files`, plain, in the order a tree lists them. Server
 * markup: one `section[data-file]` per file, its header sticky at the top
 * of the pane that scrolls it.
 */
export const PlainDiff = ({
  drawn: parsed,
  files,
  folded,
  onFold,
  prerendered,
  split = false,
}: PlainDiffProps) => {
  const drawnList = useMemo(() => parsed ?? drawnFiles(files), [files, parsed]);

  return (
    <div className="text-mono leading-code font-mono" data-diff="plain">
      {drawnList.map((drawn) => {
        const { file } = drawn;

        const closed =
          folded === undefined ? drawn.folded : folded.has(file.path);

        return (
          <section
            aria-label={file.path}
            data-file={file.path}
            data-folded={closed}
            id={diffAnchor(file.path)}
            key={file.path}
          >
            <details
              className="group/file"
              onToggle={(event) => {
                onFold?.(file.path, !event.currentTarget.open);
              }}
              open={!closed}
            >
              <summary
                className="border-rule bg-background text-mono hover:bg-surface sticky top-0 z-[1] flex h-11 cursor-pointer list-none items-center gap-2 border-y px-4 font-sans [&::-webkit-details-marker]:hidden"
                data-diffs-header=""
              >
                <FileHeaderLine file={drawn} />
              </summary>
              <FileBody
                file={drawn}
                prerendered={prerendered?.has(file.path) === true}
                split={split}
              />
            </details>
          </section>
        );
      })}
    </div>
  );
};
