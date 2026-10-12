/**
 * Takes Pierre's measures for a file drawn without a header, so the
 * highlighting arrives in place and nothing moves.
 */
import type { ReactNode } from "react";

import { linesOf } from "./file-header.tsx";

export const FALLBACK_LINES = 2000;

const GUTTER =
  "border-background text-muted-foreground hover:text-foreground min-w-[calc(6ch+2px)] border-r-2 pr-[1ch] pl-[2ch] text-right tabular-nums no-underline select-none";

export const NumberedLines = ({
  bands,
  text,
}: {
  readonly text: string;
  readonly bands?: ReadonlyMap<number, ReactNode>;
}) => {
  const lines = linesOf(text);
  const shown = lines.slice(0, FALLBACK_LINES);

  return (
    <div className="flex min-w-0 flex-col" data-code="plain">
      <pre className="text-mono leading-code overflow-x-auto py-2 font-mono">
        <code className="grid min-w-full grid-cols-[min-content_1fr]">
          {shown.map((line, index) => {
            const number = index + 1;
            const band = bands?.get(number);

            // The anchor sits on the line's text: the row around it is
            // `display: contents`, which draws no box to scroll to.
            return (
              <span className="contents" key={number}>
                {band === undefined ? null : (
                  <>
                    <span
                      aria-hidden="true"
                      className="border-background border-r-2"
                    />
                    <span className="font-sans whitespace-normal">{band}</span>
                  </>
                )}
                <a className={GUTTER} href={`#L${number}`}>
                  {number}
                </a>
                <span
                  className="px-[1ch] whitespace-pre"
                  data-line={number}
                  id={`L${number}`}
                >
                  {line}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
      {lines.length > shown.length ? (
        <p className="text-ui text-muted-foreground px-4 py-2">
          The first {FALLBACK_LINES.toLocaleString("en")} of{" "}
          {lines.length.toLocaleString("en")} lines.
        </p>
      ) : null}
    </div>
  );
};
