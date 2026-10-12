import { Layer } from "effect";

import { ProjectEnvLive } from "./env.ts";
import { ProjectVisibilityLive } from "./state.ts";

export { judgeAdmission, planAdmission } from "./admission.ts";

export type { AdmissionResult } from "./admission.ts";

export { attemptsLeft, isoWeek } from "./claims.ts";

export { ledgerFor } from "./ledger.ts";

export {
  AdmissionStarts,
  manifestPath,
  ProjectVisibilityLive,
  SaltSource,
} from "./state.ts";

export const ProjectCartridgeLive = Layer.mergeAll(
  ProjectVisibilityLive,
  ProjectEnvLive
);
