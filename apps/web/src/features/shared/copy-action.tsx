/**
 * The copied text is always text in the page, so an agent reading the HTML
 * and a screen reader both get it, never only a clipboard payload.
 */
import { Effect } from "effect";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

const copyFor = (text: string, shown: (copied: boolean) => void) =>
  Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
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

export const useCopy = (text: string) => {
  const [pressed, setPressed] = useState(false);

  return {
    copied: pressed,
    copy: () => {
      Effect.runFork(copyFor(text, setPressed));
    },
  };
};

export const CopyAction = ({
  label,
  text,
}: {
  readonly label: string;
  readonly text: string;
}) => {
  const { copied, copy } = useCopy(text);
  const Icon = copied ? Check : Copy;

  return (
    <button
      aria-label={label}
      className="text-muted-foreground hover:bg-surface hover:text-foreground relative z-10 inline-flex size-8 shrink-0 items-center justify-center transition-colors duration-[120ms] focus-visible:outline-offset-[-2px]"
      onClick={copy}
      title={label}
      type="button"
    >
      <Icon
        aria-hidden="true"
        className={`size-4 ${copied ? "text-foreground" : ""}`}
        strokeWidth={1.75}
      />
      <code className="sr-only">{text}</code>
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
