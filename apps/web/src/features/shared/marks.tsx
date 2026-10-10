/**
 * Every state the web draws, as one mark and one word: the same mark means
 * the same thing on every page. Marks are lucide's, 16 px at a 1.75
 * stroke; the word always renders beside the mark or in its row, so the
 * mark is hidden from screen readers and a page read in grayscale says the
 * same thing. Colour is the state's role, and only for state:
 *
 * - landed green: on main (a landing, a stage that passed);
 * - checking blue: running now;
 * - waiting ochre: paused on a person, a parent or a retry;
 * - refused red: a refusal, and nothing else;
 * - sealed violet: held back;
 * - ink and muted for the rest (claimed, open, not needed, a default, and
 *   a failure that is not a refusal, such as a draft that did not come).
 */
import {
  Check,
  CircleSmall,
  Circle,
  Contrast,
  Hourglass,
  LockKeyhole,
  Minus,
  OctagonX,
  RotateCcw,
  Shield,
  X,
} from "lucide-react";

import type { MarkLook } from "./mark-look.ts";

/** Every state a mark is drawn for. */
export const STATE_MARK_NAMES = [
  "landed",
  "passed",
  "checking",
  "now",
  "waiting",
  "refused",
  "retry",
  "claimed",
  "open",
  "notYet",
  "notNeeded",
  "sealed",
  "default",
  "failed",
] as const;

export type StateMark = (typeof STATE_MARK_NAMES)[number];

/** Each state's mark and its word, as it reads on its own. */
export const STATE_MARKS = {
  checking: {
    fill: true,
    icon: CircleSmall,
    tone: "text-checking",
    word: "Checking",
  },
  claimed: {
    fill: true,
    icon: Contrast,
    tone: "text-foreground",
    word: "Claimed",
  },
  default: { icon: Shield, tone: "text-foreground", word: "Default" },
  failed: { icon: X, tone: "text-foreground", word: "Failed" },
  landed: { icon: Check, tone: "text-landed", word: "Landed" },
  notNeeded: { icon: Minus, tone: "text-muted-foreground", word: "Not needed" },
  notYet: { icon: Circle, tone: "text-muted-foreground", word: "Not yet" },
  now: { fill: true, icon: CircleSmall, tone: "text-checking", word: "Now" },
  open: { icon: Circle, tone: "text-muted-foreground", word: "Open" },
  passed: { icon: Check, tone: "text-landed", word: "Passed" },
  refused: { icon: OctagonX, tone: "text-refused", word: "Refused" },
  retry: { icon: RotateCcw, tone: "text-waiting", word: "Refused, can retry" },
  sealed: { icon: LockKeyhole, tone: "text-sealed", word: "Sealed" },
  waiting: { icon: Hourglass, tone: "text-waiting", word: "Waiting" },
} as const satisfies Record<StateMark, MarkLook & { readonly word: string }>;

/** A mark's size beside 14 and 16 px text, and one a step down for 13 px lines. */
const SIZES = { md: "size-4", sm: "size-3.5" } as const;

/**
 * One mark, hidden from screen readers (its word is beside it). `stamp`
 * settles it once, as a landing's stamp does, when the viewer allows
 * motion.
 */
export const Mark = ({
  className = "",
  look,
  size = "md",
  stamp = false,
}: {
  readonly className?: string;
  readonly look: MarkLook;
  readonly size?: keyof typeof SIZES;
  readonly stamp?: boolean;
}) => {
  const Icon = look.icon;

  return (
    <Icon
      aria-hidden="true"
      className={`${SIZES[size]} shrink-0 ${look.tone} ${
        look.fill === true
          ? "[&>circle:only-child]:fill-current [&>path]:fill-current"
          : ""
      } ${stamp ? "motion-safe:animate-stamp" : ""} ${className}`}
      strokeWidth={1.75}
    />
  );
};

/** The mark of a named state. */
export const StateMarkIcon = ({
  mark,
  ...rest
}: {
  readonly className?: string;
  readonly mark: StateMark;
  readonly size?: keyof typeof SIZES;
  readonly stamp?: boolean;
}) => <Mark look={STATE_MARKS[mark]} {...rest} />;
