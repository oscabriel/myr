// A shell line a reader runs next: a refusal's `next`, a clone URL, the
// install line. The terminal is where work happens, so every page that
// suggests an action shows its command, whole and copyable, never a form.
//
// A page marks its main commands `numbered`: while the single keys are on,
// each shows its number before the `$`, and that number key copies it
// ("Copy (1)" in the button's title).
import { Check, Copy } from "lucide-react";

import { Button } from "../../components/ui/button.tsx";
import { useCopy } from "./copy-action.tsx";
import { useNumberedCommand } from "./keys.tsx";

// The command's words, each kept whole on its line: a narrow column breaks
// the line between words, never after a word's own hyphen
// (`lint-heading-levels`, `--project`) nor before a closing ` \`; a word
// longer than the line (a URL) still breaks, anywhere. Each of the
// command's own lines hangs, so a line the column breaks reads as one line
// going on. The text is the command's, space for space.
const wordsOf = (command: string) =>
  command.split("\n").map((line, at, lines) => (
    // A line never moves: its place in the command is its key.
    <span className="block pl-[6ch] -indent-[6ch]" key={at}>
      {line.split(/(?<space>\s+)(?!\\$)/u).map((part, index) =>
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
  ));

const Line = ({
  command,
  number,
}: {
  readonly command: string;
  readonly number: number | undefined;
}) => {
  const { copied, copy } = useCopy(command);

  return (
    <div className="border-rule bg-surface text-mono leading-terminal flex w-fit max-w-full min-w-0 items-start gap-2 border py-1 pr-1 pl-3 font-mono">
      {number === undefined ? null : (
        <span
          aria-hidden="true"
          className="text-muted-foreground font-sans tabular-nums select-none"
        >
          {number}
        </span>
      )}
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
        title={number === undefined ? undefined : `Copy (${number})`}
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

const NumberedLine = ({ command }: { readonly command: string }) => (
  <Line command={command} number={useNumberedCommand(command)} />
);

export const CommandLine = ({
  command,
  numbered = false,
}: {
  readonly command: string;
  /** One of the page's main commands, which a number key copies. */
  readonly numbered?: boolean;
}) =>
  numbered ? (
    <NumberedLine command={command} />
  ) : (
    <Line command={command} number={undefined} />
  );
