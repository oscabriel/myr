import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";

export const UNSTAMPED = "0.0.0";

export const versionDefine = (version: string) => ({
  "import.meta.env.CLI_BUILD_VERSION": JSON.stringify(version),
});

export const library = {
  protocol: "src/entries/protocol.ts",
  rules: "src/entries/rules.ts",
} as const;

const shared = {
  deps: {
    alwaysBundle: [/^@repo\//u],
    // pi's adapter takes it as an optional peer: never inlined.
    neverBundle: [/^@earendil-works\/pi-coding-agent(?:\/|$)/u],
  },
  // `.js` and `.d.ts`: the package is ESM by its `type`.
  fixedExtension: false,
  format: "esm",
  outDir: "dist",
  platform: "node",
} as const satisfies UserConfig;

/**
 * Bundled from tsgo's declarations: tsdown's own step declares no file
 * reached through node_modules, so workspace packages would be missing.
 */
export const declarations = (
  entry: Readonly<Record<keyof typeof library, string>>,
  tsconfig: string
) =>
  ({
    ...shared,
    clean: false,
    dts: { dtsInput: true, emitDtsOnly: true, tsconfig },
    entry,
  }) satisfies UserConfig;

// Only the first entry cleans `dist/`.
export const npm = (version: string) => {
  const stamped = { ...shared, define: versionDefine(version), dts: false };

  return [
    { ...stamped, entry: { bin: "src/bin.ts" } },
    { ...stamped, clean: false, entry: library },
    // The pi extension, which the publish manifest's `"pi"` key names.
    { ...stamped, clean: false, entry: { pi: "src/pi.ts" } },
  ] satisfies UserConfig[];
};

export default defineConfig(npm(UNSTAMPED));
