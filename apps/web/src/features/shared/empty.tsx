/**
 * An empty list, said plainly, with the way onward: the command that would
 * fill it, or a link to where to go instead. A dashed hairline marks the
 * place the rows would be, an unfilled field rather than a dead end.
 */
import type { ReactNode } from "react";

import { CommandLine } from "./command.tsx";

export const EmptyState = ({
  command,
  onward,
  title,
}: {
  /** The command that changes what is empty. */
  readonly command?: string;
  /** Where to go instead, when no command changes it: a link or two. */
  readonly onward?: ReactNode;
  /** One sentence saying what is empty. */
  readonly title: string;
}) => (
  <div className="border-rule flex flex-col items-start gap-3 border border-dashed px-4 py-5">
    <p className="text-ui text-foreground max-w-[70ch]">{title}</p>
    {command === undefined ? null : <CommandLine command={command} />}
    {onward === undefined ? null : (
      <div className="text-ui flex flex-wrap gap-x-4 gap-y-1">{onward}</div>
    )}
  </div>
);
