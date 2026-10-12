import { preset } from "@repo/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// Route modules import `cloudflare:workers`, which only workerd serves; in Node it resolves to a shim.
export default mergeConfig(
  preset,
  defineConfig({
    resolve: {
      // shadcn's `@/` imports, as in vite.config.ts.
      tsconfigPaths: true,
      alias: {
        "cloudflare:workers": new URL("test/workers-shim.ts", import.meta.url)
          .pathname,
      },
    },
    test: {
      // The shared tests read styles.css as text (`?raw`); vitest hands
      // every other stylesheet over empty.
      css: { include: [/\/src\/styles\.css/u] },
      include: ["test/**/*.test.tsx"],
      typecheck: {
        enabled: true,
        include: ["test/**/*.test-d.ts"],
        tsconfig: "./tsconfig.json",
      },
    },
  })
);
