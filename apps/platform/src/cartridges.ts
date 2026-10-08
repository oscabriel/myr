/**
 * The cartridges the platform plugs in over its own ports (`ports.ts`):
 * one marked line each, re-exporting the cartridge's layer for a stage's
 * config. Deleting a cartridge's line unplugs it, and the ports it filled
 * answer their defaults again. A static re-export, not an `import()`: a
 * dynamic import would make the bundler wrap every module it reaches in a
 * lazy initializer.
 */
import type { Layer } from "effect";

import type { PlatformConfig } from "./platform.ts";
import type { WorkerPorts } from "./ports.ts";

/**
 * A cartridge: its layer for one stage's config, over the platform's own
 * ports. What it provides are ports with defaults, so its layer adds no
 * service a host must name. It lives here so this module keeps a line of
 * its own when its last cartridge is deleted.
 */
export type Cartridge = (
  config: PlatformConfig
) => Layer.Layer<never, never, WorkerPorts>;

// cartridge: visibility
export { live as visibility } from "./visibility/live.ts";
