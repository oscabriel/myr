/**
 * Its lines live in a shadow root, where a native `#L` fragment cannot reach,
 * so the drawing scrolls to the anchored line itself.
 */
import { File } from "@pierre/diffs/react";
import type { FileOptions, SelectedLineRange } from "@pierre/diffs/react";
import { Effect, Option } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";

import { lineHash, parseLineHash } from "./line-hash.ts";
import type { LineRange } from "./line-hash.ts";
import { diffsOptions, fileOptions, registerCodeTheme } from "./pierre.ts";
import { CodePool, poolReady } from "./pool.tsx";
import { warmFile } from "./warm.ts";

registerCodeTheme();

export interface FileCodeProps {
  readonly path: string;
  readonly sha: string;
  readonly text: string;
}

const fromAddress = (): LineRange | null =>
  Option.getOrNull(parseLineHash(globalThis.location.hash));

interface Pending {
  line?: number | undefined;
  node?: HTMLElement;
}

const reveal = (pending: Pending) => {
  const { line, node } = pending;

  const row =
    line === undefined
      ? null
      : node?.shadowRoot?.querySelector(`[data-line="${line}"]`);

  if (row instanceof HTMLElement) {
    row.scrollIntoView({ block: "center", inline: "nearest" });
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
      ...fileOptions,
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
        diffsOptions.onPostRender(node);
        pending.current.node = node;
        reveal(pending.current);
      },
    }),
    []
  );

  return (
    <CodePool>
      <div className="min-w-0" data-code="pierre">
        <File file={file} options={options} selectedLines={selected} />
      </div>
    </CodePool>
  );
};

export const prepareFile = (file: FileCodeProps) =>
  Effect.tryPromise(() => poolReady()).pipe(
    Effect.andThen(Effect.tryPromise(() => warmFile(file))),
    Effect.ignore
  );

// `React.lazy` takes a module's default export.
export default FileCode;
