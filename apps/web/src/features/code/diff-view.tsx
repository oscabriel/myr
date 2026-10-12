import type { CodeViewItem, DiffLineAnnotation } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import type { CodeViewHandle, CodeViewReactOptions } from "@pierre/diffs/react";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { useLocation, useRouter } from "@tanstack/react-router";
import { Effect, Option, Predicate } from "effect";
import { Check, ChevronDown, OctagonX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { drawnFiles, emptyDiffOf } from "./diff-model.ts";
import type { DrawnFile } from "./diff-model.ts";
import { PANE_SCROLLER } from "./diff-pane.tsx";
import { diffLinesHash, parseDiffHash } from "./line-hash.ts";
import { diffOptionsFor, diffsOptions, registerCodeTheme } from "./pierre.ts";
import { CodePool, poolReady, workerPool } from "./pool.tsx";
import { SERVER_FILES } from "./prerender.ts";

registerCodeTheme();

export interface DiffAnnotation {
  readonly path: string;
  readonly line: number;
  readonly side: "additions" | "deletions";
  readonly render: () => ReactNode;
}

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
  readonly folded?: ReadonlySet<string> | undefined;
  readonly onFold?: ((path: string, folded: boolean) => void) | undefined;
  readonly drawn?: readonly DrawnFile[] | undefined;
}

const HEADER_CSS = `
[data-diffs-header] { box-shadow: inset 0 1px var(--rule); container-type: scroll-state; }
[data-diffs-header]::after { content: ""; position: absolute; inset-inline: 0; bottom: 0; height: 1px; background: transparent; }
@container scroll-state(stuck: top) { [data-diffs-header]::after { background: var(--rule); } }
@supports not (container-type: scroll-state) { [data-diffs-header]::after { background: var(--rule); } }
`;

const NO_ANNOTATIONS: readonly DiffAnnotation[] = [];

const NO_SLOTS: readonly DiffFileSlot[] = [];

/** Changes whenever what the item draws does, so `CodeView` draws it again. */
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

  // Read when the address moves: a fold made later must neither unfold the
  // named file again nor scroll back to it.
  const folds = useRef({ folded, onFold });

  useEffect(() => {
    folds.current = { folded, onFold };
  });

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
      ...diffOptionsFor(split),
      layout: { gap: 0, paddingBottom: 16, paddingTop: 0 },
      stickyHeaders: true,
      unsafeCSS: `${diffsOptions.unsafeCSS}\n${HEADER_CSS}`,
    }),
    [split]
  );

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

export const prepareDiffs = ({
  drawn,
  files,
}: Pick<DiffCodeProps, "drawn" | "files">) =>
  Effect.tryPromise(() => poolReady()).pipe(
    Effect.andThen(
      Effect.forEach(
        (drawn ?? drawnFiles(files))
          .filter((file) => !file.folded)
          .flatMap((file) => Option.toArray(file.diff))
          .slice(0, SERVER_FILES),
        (diff) =>
          "Worker" in globalThis
            ? Effect.tryPromise(() =>
                workerPool().primeDiffHighlightCache(diff)
              )
            : Effect.void,
        { concurrency: "unbounded", discard: true }
      )
    ),
    Effect.ignore
  );

// `React.lazy` takes a module's default export.
export default DiffCode;
