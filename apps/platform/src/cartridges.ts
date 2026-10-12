// A static re-export, not an `import()`: a dynamic import would make the bundler wrap every module it reaches in a lazy initializer.
import type { Layer } from "effect";

import type { PlatformConfig } from "./platform.ts";
import type { WorkerPorts } from "./ports.ts";

// Lives here so this module keeps a line of its own when its last cartridge is deleted.
export type Cartridge = (
  config: PlatformConfig
) => Layer.Layer<never, never, WorkerPorts>;

// cartridge: visibility
export { live as visibility } from "./visibility/live.ts";
