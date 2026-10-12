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

const SIZES = { md: "size-4", sm: "size-3.5" } as const;

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

export const StateMarkIcon = ({
  mark,
  ...rest
}: {
  readonly className?: string;
  readonly mark: StateMark;
  readonly size?: keyof typeof SIZES;
  readonly stamp?: boolean;
}) => <Mark look={STATE_MARKS[mark]} {...rest} />;
