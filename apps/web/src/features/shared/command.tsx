import { Check, Copy } from "lucide-react";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { useCopy } from "./copy-action.tsx";
import { useNumberedCommand } from "./keys.tsx";

type Form = "bleed" | "box";

const FormContext = createContext<Form>("box");

export const InspectorCommands = ({
  children,
}: {
  readonly children: ReactNode;
}) => <FormContext value="bleed">{children}</FormContext>;

const HANGS = { bleed: 2, box: 6 } as const satisfies Record<Form, number>;

const BOXES = {
  bleed:
    "border-rule bg-surface text-mono leading-terminal -mx-4 flex min-w-0 items-start gap-2 border-y py-1 pr-1 pl-4 font-mono",
  box: "border-rule bg-surface text-mono leading-terminal flex w-fit max-w-full min-w-0 items-start gap-2 border py-1 pr-1 pl-3 font-mono",
} as const satisfies Record<Form, string>;

/**
 * The box hugs its longest line, so a word wider than the room beside the hang
 * would be broken in two; such a line fits whole wherever its box does.
 */
const hangOf = (hang: number, words: readonly string[], line: string) =>
  Math.min(
    hang,
    line.length - Math.max(0, ...words.map(({ length }) => length))
  );

// Breaks between words, never after a word's own hyphen (`--project`) nor
// before a closing ` \`.
const wordsOf = (command: string, form: Form) =>
  command.split("\n").map((line, at, lines) => {
    const parts = line.split(/(?<space>\s+)(?!\\$)/u);

    const hang = hangOf(
      HANGS[form],
      parts.filter((part) => part.trim() !== ""),
      line
    );

    return (
      // A line never moves: its place in the command is its key.
      <span
        className="block"
        key={at}
        style={{ paddingLeft: `${hang}ch`, textIndent: `-${hang}ch` }}
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

const Line = ({
  command,
  number,
}: {
  readonly command: string;
  readonly number: number | undefined;
}) => {
  const { copied, copy } = useCopy(command);
  const form = useContext(FormContext);
  const bleed = form === "bleed";

  return (
    <div className={BOXES[form]} data-form={form}>
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
        {wordsOf(command, form)}
      </code>
      <Button
        className="shrink-0 font-sans"
        onClick={copy}
        size={bleed ? "icon-sm" : "sm"}
        title={number === undefined ? undefined : `Copy (${number})`}
        type="button"
        variant="ghost"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span
          className={
            bleed ? "sr-only" : "sr-only sm:not-sr-only @max-xs:sr-only"
          }
        >
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
  readonly numbered?: boolean;
}) =>
  numbered ? (
    <NumberedLine command={command} />
  ) : (
    <Line command={command} number={undefined} />
  );
