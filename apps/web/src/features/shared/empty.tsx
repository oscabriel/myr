import type { ReactNode } from "react";

export const EmptyState = ({
  onward,
  title,
}: {
  readonly onward?: ReactNode;
  readonly title: string;
}) => (
  <div className="border-rule flex flex-col items-start gap-3 border border-dashed px-4 py-5">
    <p className="text-ui text-foreground max-w-(--measure)">{title}</p>
    {onward === undefined ? null : (
      <div className="text-ui flex flex-wrap gap-x-4 gap-y-1">{onward}</div>
    )}
  </div>
);
