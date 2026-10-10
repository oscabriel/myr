/**
 * How a mark is drawn, and a posture's mark: kept apart from the states'
 * marks (`marks.tsx`) so the rail, on every page, carries only the three
 * icons a posture needs.
 */
import type { Posture } from "@repo/protocol/posture";
import { Eye, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** How a mark is drawn: its icon, its role's colour, and whether its icon is filled. */
export interface MarkLook {
  readonly icon: LucideIcon;
  /** The role's colour, as a text class. */
  readonly tone: string;
  /** The icon's inner shape is filled (the checking dot, the claimed half). */
  readonly fill?: true;
}

/** A project's posture as a mark: a lock in the sealed role when something is kept sealed. */
export const POSTURE_MARKS = {
  open: { icon: LockKeyholeOpen, tone: "text-muted-foreground" },
  openCore: { icon: LockKeyhole, tone: "text-sealed" },
  openOnSchedule: { icon: LockKeyhole, tone: "text-sealed" },
  openWithSealedEvidence: { icon: LockKeyhole, tone: "text-sealed" },
  sourceAvailable: { icon: Eye, tone: "text-muted-foreground" },
} as const satisfies Record<Posture, MarkLook>;
