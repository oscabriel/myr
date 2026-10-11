/**
 * A project's posture, as the honest label the platform computes from its
 * visibility config. The posture literal rides as `data-posture`, so tests
 * and styles key on it; the words are the label, never rewritten here.
 * It is a state badge: a lock in the sealed role when something is kept
 * sealed, then the label.
 */
import type { Posture } from "@repo/protocol/posture";

import { POSTURE_MARKS } from "./mark-look.ts";
import { StateBadge } from "./state-badge.tsx";

/** The label's colour: sealed when something is kept sealed, ink when nothing is, muted for a licence that is not open. */
const wordTone = {
  open: "text-foreground",
  openCore: "text-sealed",
  openOnSchedule: "text-sealed",
  openWithSealedEvidence: "text-sealed",
  sourceAvailable: "text-muted-foreground",
} as const satisfies Record<Posture, string>;

export const PostureBadge = ({
  label,
  posture,
  title,
}: {
  readonly label: string;
  readonly posture: Posture;
  /** The platform's full label, when the badge says a short form. */
  readonly title?: string | undefined;
}) => (
  <StateBadge
    className="text-ui items-start [&>svg]:mt-0.5"
    mark={POSTURE_MARKS[posture]}
    word={
      <span data-posture={posture} title={title}>
        {label}
      </span>
    }
    wordTone={wordTone[posture]}
  />
);
