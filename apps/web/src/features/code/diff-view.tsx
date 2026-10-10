/**
 * A set of changed files drawn by Pierre's `CodeView`: one scroller that
 * draws only the files in view, each file's header sticky at its top
 * (with a hairline only while it is stuck), unchanged runs folded into
 * "N unmodified lines" bars, changed words marked inside changed lines,
 * and highlighting done in the worker pool (`pool.tsx`). It sits in a
 * `DiffPane`, over the server's `PlainDiff` (the same hunks, the same
 * measures), which it replaces in place.
 *
 * Unified diffs mark each line `+` or `-`, so a change reads without
 * colour; split diffs mark the side with a bar. Each header has a chevron
 * that folds the file; an added or deleted file past 80 lines starts
 * folded. Lines can be selected, and the selection is kept in the address
 * (`#diff-<path>:L4-L7`); an address naming a file (the tree, `J`/`K`)
 * scrolls to its header.
 *
 * What a page adds, so the finish and waiver pages draw with it unedited:
 * `annotations` (a row under a line, on one side), and per file a header
 * slot (`slots[].header`, a "Mark read" button) and a status (`read`
 * marks the header with a check, `refused` with the refused cross).
 *
 * Only the browser loads this module (`client-code.tsx`).
 */
import type { CodeViewItem, DiffLineAnnotation } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import type { CodeViewHandle, CodeViewReactOptions } from "@pierre/diffs/react";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { useLocation, useRouter } from "@tanstack/react-router";
import { Option, Predicate } from "effect";
import { Check, ChevronDown, OctagonX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { drawnFiles, emptyDiffOf } from "./diff-model.ts";
import type { DrawnFile } from "./diff-model.ts";
import { PANE_SCROLLER } from "./diff-pane.tsx";
import { diffLinesHash, parseDiffHash } from "./line-hash.ts";
import { diffsOptions, registerCodeTheme } from "./pierre.ts";
import { CodePool } from "./pool.tsx";

registerCodeTheme();

/** A row a page draws under one line of one file's diff, on one side. */
export interface DiffAnnotation {
  readonly path: string;
  readonly line: number;
  readonly side: "additions" | "deletions";
  readonly render: () => ReactNode;
}

/** What a page adds to one file's header: a control, and the file's status. */
export interface DiffFileSlot {
  readonly path: string;
  readonly header?: ReactNode;
  readonly status?: "read" | "refused";
}

export interface DiffCodeProps {
  readonly files: readonly ChangedFile[];
  readonly split: boolean;
  readonly annotations?: readonly DiffAnnotation[];
  readonly slots?: readonly DiffFileSlot[];
  /** The files folded now; each file's own default when absent. */
  readonly folded?: ReadonlySet<string> | undefined;
  /** A header's fold was pressed. */
  readonly onFold?: ((path: string, folded: boolean) => void) | undefined;
  /**
   * The files already parsed, in the order to draw them: a decision's diff
   * comes as a patch, with no whole texts to parse `files` from.
   */
  readonly drawn?: readonly DrawnFile[] | undefined;
}

/**
 * The header's hairline, only while it is stuck at the top (where the
 * browser can tell); a plain one where it cannot. Each header also carries
 * a hairline above it, parting one file from the next.
 */
const HEADER_CSS = `
[data-diffs-header] { box-shadow: inset 0 1px var(--rule); container-type: scroll-state; }
[data-diffs-header]::after { content: ""; position: absolute; inset-inline: 0; bottom: 0; height: 1px; background: transparent; }
@container scroll-state(stuck: top) { [data-diffs-header]::after { background: var(--rule); } }
@supports not (container-type: scroll-state) { [data-diffs-header]::after { background: var(--rule); } }
`;

const NO_ANNOTATIONS: readonly DiffAnnotation[] = [];

const NO_SLOTS: readonly DiffFileSlot[] = [];

/**
 * An item's version: it changes whenever what the item draws does (folded
 * or not, the lines its annotations sit on), so `CodeView` draws it again.
 */
const versionOf = (
  folded: boolean,
  annotations: readonly DiffLineAnnotation<DiffAnnotation>[]
) => {
  let hash = folded ? 1 : 0;

  for (const { lineNumber, side } of annotations) {
    hash =
      (hash * 31 + lineNumber * 2 + (side === "additions" ? 1 : 0)) %
      2_147_483_647;
  }

  return hash * 2 + annotations.length;
};

/** One file as `CodeView` holds it; a binary or unsent file as a header with no lines. */
const itemOf = (
  drawn: DrawnFile,
  folded: boolean,
  annotations: readonly DiffAnnotation[]
): CodeViewItem<DiffAnnotation> => {
  const mine = annotations.flatMap((annotation) =>
    annotation.path === drawn.file.path
      ? [
          {
            lineNumber: annotation.line,
            metadata: annotation,
            side: annotation.side,
          } satisfies DiffLineAnnotation<DiffAnnotation>,
        ]
      : []
  );

  return {
    annotations: mine,
    collapsed: folded,
    fileDiff: Option.getOrElse(drawn.diff, () => emptyDiffOf(drawn.file)),
    id: drawn.file.path,
    type: "diff",
    version: versionOf(folded, mine),
  };
};

/** The address's fragment, handed up as it changes; only inside a router. */
const HashFollower = ({
  onHash,
}: {
  readonly onHash: (hash: string) => void;
}) => {
  const hash = useLocation({ select: (location) => location.hash });

  useEffect(() => {
    onHash(hash);
  }, [hash, onHash]);

  return null;
};

/** Scroll the pane into place, then the file's header to its top. */
const reveal = (
  handle: CodeViewHandle<DiffAnnotation, undefined> | null,
  container: HTMLElement | null,
  path: string
) => {
  container?.closest("[data-diff-pane]")?.scrollIntoView({ block: "start" });
  handle?.scrollTo({ align: "start", id: path, type: "item" });
};

export const DiffCode = ({
  annotations = NO_ANNOTATIONS,
  drawn: parsed,
  files,
  folded,
  onFold,
  slots = NO_SLOTS,
  split,
}: DiffCodeProps) => {
  const handle = useRef<CodeViewHandle<DiffAnnotation, undefined>>(null);
  const container = useRef<HTMLDivElement>(null);
  const [hash, setHash] = useState("");

  const drawn = useMemo(() => parsed ?? drawnFiles(files), [files, parsed]);

  const items = useMemo(
    () =>
      drawn.map((file) =>
        itemOf(
          file,
          folded === undefined ? file.folded : folded.has(file.file.path),
          annotations
        )
      ),
    [annotations, drawn, folded]
  );

  const byPath = useMemo(
    () =>
      new Map<string, DrawnFile>(drawn.map((file) => [file.file.path, file])),
    [drawn]
  );

  const slotOf = (path: string) => slots.find((slot) => slot.path === path);

  // The folds as they are now, read when the address moves: a fold the
  // reader makes later must neither unfold the named file again nor
  // scroll back to it.
  const folds = useRef({ folded, onFold });

  useEffect(() => {
    folds.current = { folded, onFold };
  });

  // An address naming a file scrolls to it, and its lines are selected.
  useEffect(() => {
    const named = parseDiffHash(hash);

    if (Option.isNone(named) || !byPath.has(named.value.path)) {
      return;
    }

    const { lines, path } = named.value;

    if (folds.current.folded?.has(path) === true) {
      folds.current.onFold?.(path, false);
    }

    reveal(handle.current, container.current, path);

    if (Option.isSome(lines)) {
      handle.current?.setSelectedLines({
        id: path,
        range: {
          end: lines.value.end,
          side: lines.value.side,
          start: lines.value.start,
        },
      });
      handle.current?.scrollTo({
        align: "center",
        id: path,
        lineNumber: lines.value.start,
        side: lines.value.side,
        type: "line",
      });
    }
  }, [byPath, hash]);

  const options = useMemo(
    (): CodeViewReactOptions<DiffAnnotation, undefined> => ({
      ...diffsOptions,
      diffIndicators: split ? "bars" : "classic",
      diffStyle: split ? "split" : "unified",
      enableLineSelection: true,
      hunkSeparators: "line-info",
      layout: { gap: 0, paddingBottom: 16, paddingTop: 0 },
      lineDiffType: "word-line",
      lineHoverHighlight: "both",
      overflow: "scroll",
      stickyHeaders: true,
      unsafeCSS: `${diffsOptions.unsafeCSS}\n${HEADER_CSS}`,
    }),
    [split]
  );

  // A view drawn with no router around it (its own test) follows no address.
  const router = useRouter({ warn: false });

  return (
    <CodePool>
      {Predicate.isNotNullish(router) ? (
        <HashFollower onHash={setHash} />
      ) : null}
      <div className="contents" data-diff="pierre">
        <CodeView<DiffAnnotation>
          className={PANE_SCROLLER}
          containerRef={container}
          items={items}
          onSelectedLinesChange={(selection) => {
            const url = `${globalThis.location.pathname}${globalThis.location.search}`;

            globalThis.history.replaceState(
              globalThis.history.state,
              "",
              selection === null
                ? url
                : `${url}#${diffLinesHash({
                    end: Math.max(selection.range.start, selection.range.end),
                    path: selection.id,
                    side: selection.range.side ?? "additions",
                    start: Math.min(selection.range.start, selection.range.end),
                  })}`
            );
          }}
          options={options}
          ref={handle}
          renderAnnotation={(annotation) => annotation.metadata?.render()}
          renderHeaderMetadata={(item) => {
            const file = byPath.get(item.id);
            const slot = slotOf(item.id);

            return (
              // Pierre prints the counts itself; what it cannot say is here.
              <span className="flex items-center gap-3 font-sans">
                {file === undefined || Option.isSome(file.diff) ? null : (
                  <span className="text-muted-foreground">
                    {file.file.binary ? "binary" : "not shown"}
                  </span>
                )}
                {slot?.header}
              </span>
            );
          }}
          renderHeaderPrefix={(item) => {
            const closed = item.collapsed === true;

            return (
              <button
                aria-expanded={!closed}
                aria-label={`${closed ? "Unfold" : "Fold"} ${item.id}`}
                className="text-muted-foreground hover:text-foreground -ml-1 flex size-6 items-center justify-center"
                onClick={() => {
                  onFold?.(item.id, !closed);
                }}
                type="button"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 transition-transform duration-150 ${closed ? "-rotate-90" : ""}`}
                  strokeWidth={1.75}
                />
              </button>
            );
          }}
          renderHeaderFilenameSuffix={(item) => {
            const status = slotOf(item.id)?.status;

            if (status === "refused") {
              return (
                <span className="text-refused flex items-center gap-1 font-sans">
                  <OctagonX
                    aria-hidden="true"
                    className="size-3.5"
                    strokeWidth={1.75}
                  />
                  <span className="sr-only">refused here</span>
                </span>
              );
            }

            return status === "read" ? (
              <span className="text-muted-foreground flex items-center gap-1 font-sans">
                <Check
                  aria-hidden="true"
                  className="size-3.5"
                  strokeWidth={1.75}
                />
                <span className="sr-only">read</span>
              </span>
            ) : null;
          }}
        />
      </div>
    </CodePool>
  );
};

// `React.lazy` takes a module's default export.
export default DiffCode;
