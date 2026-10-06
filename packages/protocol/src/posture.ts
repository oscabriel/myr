import { Schema } from "effect";

/** The label the platform computes from a project's visibility config. */
export const Posture = Schema.Literals([
  "open",
  "openWithSealedEvidence",
  "openOnSchedule",
  "openCore",
  "sourceAvailable",
]);

export type Posture = typeof Posture.Type;
