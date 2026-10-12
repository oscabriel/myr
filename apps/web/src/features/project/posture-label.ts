/**
 * The project list carries only the literal; until it carries the platform's
 * full label, each posture reads as its own name, never as a claim about what
 * is sealed.
 */
import type { Posture } from "@repo/protocol/posture";

const labels = {
  open: "Open",
  openCore: "Open core",
  openOnSchedule: "Open on schedule",
  openWithSealedEvidence: "Open with sealed evidence",
  sourceAvailable: "Source available",
} as const satisfies Record<Posture, string>;

export const postureLabel = (posture: Posture): string => labels[posture];

const words = {
  open: "Open",
  openCore: "Open core",
  openOnSchedule: "Open on schedule",
  openWithSealedEvidence: "Sealed evidence",
  sourceAvailable: "Source available",
} as const satisfies Record<Posture, string>;

export const postureWord = (posture: Posture): string => words[posture];
