/**
 * One file, drawn by `@pierre/diffs`: highlighted (Shiki's JavaScript
 * engine, never its WASM one), its lines selectable, the selection kept in
 * the address as `#L10` or `#L10-L20` (`line-hash.ts`) and scrolled to on
 * load. Its lines live in a shadow root, where a native `#L` fragment
 * cannot reach, so the drawing scrolls to the anchored line itself.
 *
 * It is Pierre's `File`, not its virtualized `CodeView`, which draws
 * nothing until it mounts; a file is capped at 1 MiB, and past
 * `HIGHLIGHT_LIMIT` characters it is drawn without highlighting.
 *
 * The library and Shiki's grammars are megabytes, so only the browser
 * loads this module (`client-code.tsx`); the Worker never bundles it.
 */
import { DEFAULT_THEMES } from "@pierre/diffs";
import { File } from "@pierre/diffs/react";
import type { FileOptions, SelectedLineRange } from "@pierre/diffs/react";
import { Option } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";

import { lineHash, parseLineHash } from "./line-hash.ts";
import type { LineRange } from "./line-hash.ts";

/** Past this many characters a file is drawn without highlighting. */
const HIGHLIGHT_LIMIT = 300_000;

export interface FileCodeProps {
  readonly path: string;
  /** The blob's id: the drawing's cache key. */
  readonly sha: string;
  readonly text: string;
}

/** The lines the address names now, if any. */
const fromAddress = (): LineRange | null =>
  Option.getOrNull(parseLineHash(globalThis.location.hash));

/** The drawing once it has rendered, and the line to bring into view in it. */
interface Pending {
  line?: number | undefined;
  node?: HTMLElement;
}

/**
 * Scrolls the drawing to the pending line, once: the line clears when it
 * is found, so later renders leave the reader where they are.
 */
const reveal = (pending: Pending) => {
  const { line, node } = pending;

  const row =
    line === undefined
      ? null
      : node?.shadowRoot?.querySelector(`[data-line="${line}"]`);

  if (row !== null && row !== undefined) {
    row.scrollIntoView({ block: "center" });
    pending.line = undefined;
  }
};

export const FileCode = ({ path, sha, text }: FileCodeProps) => {
  const [selected, setSelected] = useState<LineRange | null>(null);
  const pending = useRef<Pending>({});

  useEffect(() => {
    const read = () => {
      const range = fromAddress();

      setSelected(range);
      pending.current.line = range?.start;
      reveal(pending.current);
    };

    read();
    globalThis.addEventListener("hashchange", read);

    return () => {
      globalThis.removeEventListener("hashchange", read);
    };
  }, []);

  const file = useMemo(
    () => ({ cacheKey: sha, contents: text, name: path }),
    [path, sha, text]
  );

  const options = useMemo(
    (): FileOptions<undefined, undefined> => ({
      enableLineSelection: true,
      lineHoverHighlight: "number",
      onLineSelected: (range: SelectedLineRange | null) => {
        const lines =
          range === null
            ? null
            : {
                end: Math.max(range.start, range.end),
                start: Math.min(range.start, range.end),
              };

        setSelected(lines);
        globalThis.history.replaceState(
          globalThis.history.state,
          "",
          lines === null
            ? `${globalThis.location.pathname}${globalThis.location.search}`
            : lineHash(lines)
        );
      },
      onPostRender: (node: HTMLElement) => {
        pending.current.node = node;
        reveal(pending.current);
      },
      overflow: "scroll",
      preferredHighlighter: "shiki-js",
      theme: DEFAULT_THEMES,
      themeType: "system",
      tokenizeMaxLength: HIGHLIGHT_LIMIT,
    }),
    []
  );

  return (
    <div className="border-rule min-w-0 border" data-code="pierre">
      <File file={file} options={options} selectedLines={selected} />
    </div>
  );
};

// `React.lazy` takes a module's default export.
export default FileCode;
