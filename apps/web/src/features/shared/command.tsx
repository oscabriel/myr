/**
 * A shell line a reader runs next: a refusal's `next`, a clone URL, the
 * install line. The terminal is where work happens, so every page that
 * suggests an action shows its command, whole and copyable, never a form.
 */
import { Effect } from "effect";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button.tsx";

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

export const CommandLine = ({ command }: { readonly command: string }) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    Effect.runFork(copyFor(command, setCopied));
  };

  return (
    <div className="border-rule bg-surface text-mono leading-terminal flex w-fit max-w-full min-w-0 items-start gap-2 border py-1 pr-1 pl-3 font-mono">
      <span aria-hidden="true" className="text-muted-foreground select-none">
        $
      </span>
      <code className="min-w-0 flex-1 py-0.5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap select-all">
        {command}
      </code>
      <Button
        className="shrink-0 font-sans"
        onClick={copy}
        size="sm"
        type="button"
        variant="ghost"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span className="sr-only sm:not-sr-only">
          {copied ? "Copied" : "Copy"}
        </span>
      </Button>
    </div>
  );
};
