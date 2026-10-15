import { Check, Copy } from "lucide-react";
import type { CSSProperties } from "react";

import { Button } from "../../components/ui/button.tsx";
import { useCopy } from "./copy-action.tsx";

const HANG = 6;

const BOX =
  "border-rule bg-surface text-mono leading-terminal flex w-fit max-w-full min-w-0 items-start gap-2 border py-1 pr-1 pl-3 font-mono";

/**
 * The box hugs its longest line, so a word wider than the room beside the hang
 * would be broken in two; such a line fits whole wherever its box does.
 */
const hangOf = (hang: number, words: readonly string[], line: string) =>
  Math.min(
    hang,
    line.length - Math.max(0, ...words.map(({ length }) => length))
  );

/** The hang as a variable, which the line takes from `tablet` only: on a phone the words want the whole width. */
const hangStyle = (
  hang: number
): CSSProperties & { readonly "--hang": string } => ({
  "--hang": `${hang}ch`,
});

// Breaks between words, never after a word's own hyphen (`--project`) nor
// before a closing ` \`.
const wordsOf = (command: string) =>
  command.split("\n").map((line, at, lines) => {
    const parts = line.split(/(?<space>\s+)(?!\\$)/u);

    const hang = hangOf(
      HANG,
      parts.filter((part) => part.trim() !== ""),
      line
    );

    return (
      // A line never moves: its place in the command is its key.
      <span
        className="tablet:pl-(--hang) tablet:-indent-(--hang) block"
        key={at}
        style={hangStyle(hang)}
      >
        {parts.map((part, index) =>
          part.trim() === "" ? (
            part
          ) : (
            <span
              className="inline-block max-w-full indent-0 [overflow-wrap:anywhere]"
              key={index}
            >
              {part}
            </span>
          )
        )}
        {at < lines.length - 1 ? "\n" : null}
      </span>
    );
  });

export const CommandLine = ({ command }: { readonly command: string }) => {
  const { copied, copy } = useCopy(command);

  return (
    <div className={BOX}>
      <span aria-hidden="true" className="text-muted-foreground select-none">
        $
      </span>
      <code className="min-w-0 flex-1 py-0.5 whitespace-pre-wrap select-all">
        {wordsOf(command)}
      </code>
      <Button
        className="shrink-0 font-sans"
        onClick={copy}
        size="sm"
        type="button"
        variant="ghost"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span className="sr-only sm:not-sr-only @max-xs:sr-only">
          {copied ? "Copied" : "Copy"}
        </span>
      </Button>
    </div>
  );
};
