/**
 * A command copied with one press. The command itself is always text in
 * the page (inside the button, visually hidden where only the icon shows),
 * so an agent reading the HTML and a screen reader both get it, never only
 * a clipboard payload. After a copy the button shows a check and says
 * "Copied" for two seconds, once, in a polite live region.
 *
 * - `CopyAction`: a row's ghost button, 32 px square, named for what it
 *   copies ("Copy claim command").
 * - `CommandChip`: the command shown whole, small, at the end of a status
 *   line; pressing it copies it.
 *
 * Either can be numbered: while the single keys are on, its number copies
 * it, and shows in its title ("Copy claim command (1)").
 */
import { Effect, Option } from "effect";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { useCopiedCommand, useNumberedCommand } from "./keys.tsx";

/** Copy `command`, then show it copied for two seconds. */
const copyFor = (command: string, shown: (copied: boolean) => void) =>
  Effect.tryPromise(() => navigator.clipboard.writeText(command)).pipe(
    Effect.andThen(
      Effect.sync(() => {
        shown(true);
      })
    ),
    Effect.andThen(Effect.sleep("2 seconds")),
    Effect.andThen(
      Effect.sync(() => {
        shown(false);
      })
    ),
    Effect.ignore
  );

/**
 * Copying `command`: whether it was just copied (by this control, or by its
 * number key), and the press that copies it.
 */
export const useCopy = (command: string) => {
  const [pressed, setPressed] = useState(false);
  const byKey = useCopiedCommand();

  return {
    copied: pressed || Option.contains(byKey, command),
    copy: () => {
      Effect.runFork(copyFor(command, setPressed));
    },
  };
};

interface CopyProps {
  readonly command: string;
  /** What the button copies, as its accessible name: "Copy claim command". */
  readonly label: string;
  /** Whether the page's number keys reach it. */
  readonly numbered?: boolean;
}

const ActionButton = ({
  command,
  label,
  number,
}: Omit<CopyProps, "numbered"> & { readonly number: number | undefined }) => {
  const { copied, copy } = useCopy(command);
  const Icon = copied ? Check : Copy;

  return (
    <button
      aria-label={label}
      className="text-muted-foreground hover:bg-surface hover:text-foreground relative z-10 inline-flex size-8 shrink-0 items-center justify-center transition-colors duration-[120ms] focus-visible:outline-offset-[-2px]"
      onClick={copy}
      title={number === undefined ? label : `${label} (${number})`}
      type="button"
    >
      <Icon
        aria-hidden="true"
        className={`size-4 ${copied ? "text-foreground" : ""}`}
        strokeWidth={1.75}
      />
      <code className="sr-only">{command}</code>
      <span
        aria-live="polite"
        className={
          copied
            ? "text-label text-foreground bg-background pointer-events-none absolute right-full mr-1 whitespace-nowrap"
            : "sr-only"
        }
      >
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
};

const NumberedAction = (props: Omit<CopyProps, "numbered">) => (
  <ActionButton {...props} number={useNumberedCommand(props.command)} />
);

/** A row's copy button: the icon in sight, the command in the text. */
export const CopyAction = ({ numbered = false, ...props }: CopyProps) =>
  numbered ? (
    <NumberedAction {...props} />
  ) : (
    <ActionButton {...props} number={undefined} />
  );

/** A command shown whole and small (a status line's next step); pressing it copies it. */
export const CommandChip = ({ command }: { readonly command: string }) => {
  const { copied, copy } = useCopy(command);
  const Icon = copied ? Check : Copy;

  return (
    <button
      className="border-rule bg-surface hover:border-input text-mono inline-flex max-w-full min-w-0 items-center gap-1.5 border px-1.5 align-baseline font-mono transition-colors duration-[120ms]"
      onClick={copy}
      title={`Copy: ${command}`}
      type="button"
    >
      <span className="sr-only">Copy </span>
      <code className="min-w-0 text-left [overflow-wrap:anywhere]">
        {command}
      </code>
      <Icon
        aria-hidden="true"
        className="text-muted-foreground size-3.5 shrink-0"
        strokeWidth={1.75}
      />
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
};
