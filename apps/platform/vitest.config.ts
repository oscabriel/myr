import { preset } from "@repo/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// Worker modules import `cloudflare:workers`, which only workerd serves; in
// Node it resolves to a shim. An alias resolves to a file, not a folder.
export default mergeConfig(
  preset,
  defineConfig({
    resolve: {
      alias: {
        "cloudflare:workers": new URL("test/workers-shim.ts", import.meta.url)
          .pathname,
      },
    },
  })
);
