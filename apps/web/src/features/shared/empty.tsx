/**
 * An empty list, said plainly, with the command that would fill it: an
 * unfilled field on the report, not a dead end.
 */
import { CommandLine } from "./command.tsx";

export const EmptyState = ({
  command,
  title,
}: {
  readonly command?: string;
  readonly title: string;
}) => (
  <div className="border-rule flex flex-col gap-3 border border-dashed px-4 py-5">
    <p className="text-sm font-medium">{title}</p>
    {command === undefined ? null : <CommandLine command={command} />}
  </div>
);
