import { preset } from "@repo/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// Worker modules import `cloudflare:workers`, which only workerd serves; in Node it
// resolves to a shim. The OAuth provider imports it too, so vitest processes that
// package instead of handing it to Node.
export default mergeConfig(
  preset,
  defineConfig({
    resolve: {
      alias: {
        "cloudflare:workers": new URL("test/workers-shim.ts", import.meta.url)
          .pathname,
      },
    },
    test: {
      server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
    },
  })
);
