/**
 * The posture literal rides as `data-posture`, so tests and styles key on it;
 * the words are the platform's label, never rewritten here.
 */
import type { Posture } from "@repo/protocol/posture";

import { POSTURE_MARKS } from "./mark-look.ts";
import { StateBadge } from "./state-badge.tsx";

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
