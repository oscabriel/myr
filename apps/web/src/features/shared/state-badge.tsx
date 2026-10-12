import { Predicate } from "effect";
import type { ReactNode } from "react";

import type { MarkLook } from "./mark-look.ts";
import { Mark, STATE_MARKS } from "./marks.tsx";
import type { StateMark } from "./marks.tsx";

export interface StateBadgeProps {
  readonly mark: StateMark | MarkLook;
  readonly word?: ReactNode;
  readonly wordTone?: string;
  readonly small?: boolean;
  readonly stamp?: boolean;
  readonly className?: string;
  readonly data?: Readonly<Record<`data-${string}`, string>>;
}

export const StateBadge = ({
  className = "",
  data,
  mark,
  small = false,
  stamp = false,
  word,
  wordTone,
}: StateBadgeProps) => {
  const look = Predicate.isString(mark) ? STATE_MARKS[mark] : mark;

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 align-middle ${className}`}
      data-mark={Predicate.isString(mark) ? mark : undefined}
      {...data}
    >
      <Mark look={look} size={small ? "sm" : "md"} stamp={stamp} />
      <span className={`min-w-0 font-medium ${wordTone ?? look.tone}`}>
        {word ?? (Predicate.isString(mark) ? STATE_MARKS[mark].word : null)}
      </span>
    </span>
  );
};
