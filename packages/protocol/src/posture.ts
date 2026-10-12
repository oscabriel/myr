import { Schema } from "effect";

export const Posture = Schema.Literals([
  "open",
  "openWithSealedEvidence",
  "openOnSchedule",
  "openCore",
  "sourceAvailable",
]);

export type Posture = typeof Posture.Type;
