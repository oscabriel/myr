/**
 * The visibility cartridge's side of the project service: the
 * `ProjectVisibility` and `ProjectEnv` ports it provides, merged. The
 * platform plugs it in by one marked line (`apps/platform/src/ports.ts`,
 * through `apps/platform/src/visibility/live.ts`); without it the project
 * service runs on the ports' neutral defaults. Nothing outside the
 * cartridge imports this folder.
 */
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

/**
 * Both ports, over the private namespace's repos, a salt source and what
 * starts admissions (the platform's `apps/platform/src/visibility/state.ts`
 * gives all three).
 */
export const ProjectCartridgeLive = Layer.mergeAll(
  ProjectVisibilityLive,
  ProjectEnvLive
);
