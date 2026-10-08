/**
 * The visibility cartridge's env (W6; 614 builds it): the env shape parsed
 * from every `.env.schema` at the landed SHA, write-only values sealed by
 * the platform's master key, placeholders and proxies for checks of
 * unlanded code, the scan for stored values, and `ProxyWidened` decisions,
 * as the `ProjectEnv` port.
 *
 * A stub until 614: it answers the port's neutral defaults (no items, no
 * values, nothing to scan for).
 */
import { Layer } from "effect";

import { noEnv, ProjectEnv } from "../env-port.ts";

export const ProjectEnvLive: Layer.Layer<never> = Layer.succeed(
  ProjectEnv,
  noEnv
);
