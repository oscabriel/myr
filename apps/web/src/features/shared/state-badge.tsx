/**
 * The one way the web shows a state in a word: its mark, then its word in
 * the state's role, at the size of the line it sits in. No pill, no fill,
 * no box: the mark and the word are the badge. A posture, a stage, an
 * ask's standing and a decision's default all draw through it.
 */
import { Predicate } from "effect";
import type { ReactNode } from "react";

import type { MarkLook } from "./mark-look.ts";
import { Mark, STATE_MARKS } from "./marks.tsx";
import type { StateMark } from "./marks.tsx";

export interface StateBadgeProps {
  /** A named state, or a look of its own (a posture's). */
  readonly mark: StateMark | MarkLook;
  /** The word, when the state's own word is not the one to say. */
  readonly word?: ReactNode;
  /** The word's colour, when it is not the mark's role (a posture's word is muted). */
  readonly wordTone?: string;
  /** A step down, for 13 px lines (a stage's cell). */
  readonly small?: boolean;
  /** Settle the mark once, as a landing's stamp does. */
  readonly stamp?: boolean;
  readonly className?: string;
  /** What the badge stands for, for tests and styles (`data-posture`, `data-state`). */
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
