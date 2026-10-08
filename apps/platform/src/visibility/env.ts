/**
 * The visibility cartridge's env, as the platform provides it (W6; 614
 * fills it in): the project service's `ProjectEnv` over the `.env.schema`
 * parser and the vault that seals write-only values with `MASTER_KEY`.
 *
 * A stub until 614: the env port's neutral defaults.
 */
import { ProjectEnvLive } from "@repo/project/visibility/env";
import type { Layer } from "effect";

import type { PlatformConfig } from "../platform.ts";

export const envLive = (_config: PlatformConfig): Layer.Layer<never> =>
  ProjectEnvLive;
