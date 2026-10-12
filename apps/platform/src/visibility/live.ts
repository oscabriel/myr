import { Layer } from "effect";

import type { PlatformConfig } from "../platform.ts";
import type { WorkerPorts } from "../ports.ts";
import { envLive } from "./env.ts";
import { heldBackLive } from "./held-back.ts";
import { layersLive } from "./layers.ts";
import { stateLive } from "./state.ts";

export const live = (
  config: PlatformConfig
): Layer.Layer<never, never, WorkerPorts> =>
  Layer.mergeAll(
    layersLive(config),
    stateLive(config),
    envLive(config),
    heldBackLive(config)
  );
