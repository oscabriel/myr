/**
 * Kept apart from `marks.tsx` so a list of projects carries only the three
 * icons a posture needs.
 */
import type { Posture } from "@repo/protocol/posture";
import { Eye, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface MarkLook {
  readonly icon: LucideIcon;
  readonly tone: string;
  readonly fill?: true;
}

export const POSTURE_MARKS = {
  open: { icon: LockKeyholeOpen, tone: "text-muted-foreground" },
  openCore: { icon: LockKeyhole, tone: "text-sealed" },
  openOnSchedule: { icon: LockKeyhole, tone: "text-sealed" },
  openWithSealedEvidence: { icon: LockKeyhole, tone: "text-sealed" },
  sourceAvailable: { icon: Eye, tone: "text-muted-foreground" },
} as const satisfies Record<Posture, MarkLook>;
