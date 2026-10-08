/**
 * A posture in the words GLOSSARY.md gives it ("Posture"). The project list
 * and the front page carry only the literal; the fuller label the platform
 * computes from a project's visibility config ("Open · sealed checks in
 * parser") is the ledger's. Until a listing carries that
 * label, each posture reads as its own name, never as a claim about what is
 * sealed.
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
