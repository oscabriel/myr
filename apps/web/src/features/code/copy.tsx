/**
 * A button that copies `text` and says so for two seconds, as the command
 * lines do (`shared/command.tsx`).
 */
import { Effect } from "effect";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

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

export const CopyButton = ({
  label,
  text,
}: {
  readonly label: string;
  readonly text: string;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    Effect.runFork(copyFor(text, setCopied));
  };

  return (
    <Button onClick={copy} size="sm" type="button" variant="ghost">
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  );
};
