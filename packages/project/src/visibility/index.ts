/**
 * The visibility cartridge's side of the project service (W6 609): the
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

/** Both ports, over the private namespace's repos. */
export const ProjectCartridgeLive = Layer.mergeAll(
  ProjectVisibilityLive,
  ProjectEnvLive
);
