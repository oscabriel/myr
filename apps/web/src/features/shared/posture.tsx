/**
 * A project's posture, as the honest label the platform computes from its
 * visibility config. The posture literal rides as `data-posture`, so tests
 * and styles key on it; the words are the label, never rewritten here.
 */
import type { Posture } from "@repo/protocol/posture";

import { Badge } from "../../components/ui/badge.tsx";

/** Postures that keep something sealed read in the sealed role; the rest in ink. */
const tone = {
  open: "border-rule-strong text-foreground",
  openCore: "border-sealed text-sealed",
  openOnSchedule: "border-sealed text-sealed",
  openWithSealedEvidence: "border-sealed text-sealed",
  sourceAvailable: "border-rule text-muted-foreground",
} as const satisfies Record<Posture, string>;

export const PostureBadge = ({
  label,
  posture,
}: {
  readonly label: string;
  readonly posture: Posture;
}) => (
  <Badge
    className={`h-auto bg-transparent py-0.5 text-left whitespace-normal ${tone[posture]}`}
    data-posture={posture}
    variant="outline"
  >
    {label}
  </Badge>
);
