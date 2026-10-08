/**
 * The npm build of the CLI, which `build.ts` runs first: `dist/bin.js`, the
 * command line under Node or Bun, and two library entries, `./rules` (the
 * sdk a config folder imports) and `./protocol` (the types its data has).
 * Workspace packages are inlined, so the published package names none of
 * them; `effect` and `@effect/platform-bun`, the package's own
 * dependencies, stay imports.
 */
import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";

/** The library entries, by the name each is published under. */
export const library = {
  protocol: "src/entries/protocol.ts",
  rules: "src/entries/rules.ts",
} as const;

const shared = {
  deps: {
    alwaysBundle: [/^@repo\//u],
    // pi's adapter takes it as an optional peer (W7 706): never inlined.
    neverBundle: [/^@earendil-works\/pi-coding-agent(?:\/|$)/u],
  },
  // `.js` and `.d.ts`: the package is ESM by its `type`.
  fixedExtension: false,
  format: "esm",
  outDir: "dist",
  platform: "node",
} as const satisfies UserConfig;

/**
 * The library entries' types, bundled from declarations `build.ts` has had
 * tsgo write (tsdown's own declaration step passes tsgo this package as its
 * `rootDir`, and TypeScript declares no file it reached through
 * `node_modules`, so every workspace package would be missing). `entry`
 * names each entry's declaration file; `tsconfig` maps each workspace
 * package onto its declarations, so they are inlined too.
 */
export const declarations = (
  entry: Readonly<Record<keyof typeof library, string>>,
  tsconfig: string
) =>
  ({
    ...shared,
    // The npm build wrote `dist/` first; this only adds to it.
    clean: false,
    dts: { dtsInput: true, emitDtsOnly: true, tsconfig },
    entry,
  }) satisfies UserConfig;

export default defineConfig([
  { ...shared, dts: false, entry: { bin: "src/bin.ts" } },
  { ...shared, dts: false, entry: library },
  // The pi extension (W7 706), which the publish manifest's `"pi"` key names.
  { ...shared, dts: false, entry: { pi: "src/pi.ts" } },
]);
