import { preset } from "@repo/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// `cloudflare:workers` only exists in workerd; the SDK is inlined so the
// alias reaches its import too.
export default mergeConfig(
  preset,
  defineConfig({
    resolve: {
      alias: {
        "cloudflare:workers": new URL("test/workers-shim.ts", import.meta.url)
          .pathname,
      },
    },
    test: { server: { deps: { inline: ["@cloudflare/sandbox"] } } },
  })
);
