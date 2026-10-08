/**
 * The visibility cartridge, whole (W6 609; SYN cut line 5): the gateway's
 * layer repos (`layers.ts`), the project service's visibility state
 * (`state.ts`) and env (`env.ts`), for one stage's config, over the
 * platform's own ports. `ports.ts` plugs it in by one marked line;
 * deleting that line, this folder, `@repo/visibility` and the
 * `ARTIFACTS_PRIVATE` binding leaves the platform without typed visibility
 * (`packages/config/test/cartridge.test.ts` lists what to delete).
 */
import { Layer } from "effect";

import type { PlatformConfig } from "../platform.ts";
import type { WorkerPorts } from "../ports.ts";
import { envLive } from "./env.ts";
import { layersLive } from "./layers.ts";
import { stateLive } from "./state.ts";

/** The cartridge's layer for one stage's config, filling `LayerGate`, `ProjectVisibility` and `ProjectEnv`. */
export const live = (
  config: PlatformConfig
): Layer.Layer<never, never, WorkerPorts> =>
  Layer.mergeAll(layersLive(config), stateLive(config), envLive(config));
