/**
 * The cartridges the platform plugs in over its own ports (`ports.ts`):
 * one marked line each, re-exporting the cartridge's layer for a stage's
 * config. Deleting a cartridge's line unplugs it, and the ports it filled
 * answer their defaults again. A static re-export, not an `import()`: a
 * dynamic import would make the bundler wrap every module it reaches in a
 * lazy initializer.
 */
// cartridge: visibility
export { live as visibility } from "./visibility/live.ts";
