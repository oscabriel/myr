import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import {
  MANIFEST_PATH,
  webManifestText,
} from "./src/features/agents/manifest.ts";

/**
 * The web app manifest (issue 505), made from `Brand.name` rather than kept
 * as a file that would spell the name: written into the client output at
 * each build, beside `public/`'s icons, and served by the dev server.
 */
const webAppManifest = (): Plugin => ({
  configureServer: (server) => {
    server.middlewares.use(MANIFEST_PATH, (_request, response) => {
      response.setHeader("content-type", "application/manifest+json");
      response.end(webManifestText());
    });
  },
  generateBundle() {
    if (this.environment.name === "client") {
      this.emitFile({
        fileName: MANIFEST_PATH.slice(1),
        source: webManifestText(),
        type: "asset",
      });
    }
  },
  name: "web-app-manifest",
});

// The Cloudflare framework guide's order: the Worker runs TanStack Start's
// SSR environment, and Start comes before React. `vite build` picks the
// stage from `CLOUDFLARE_ENV` (infra/deploy.ts sets it).
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    webAppManifest(),
  ],
  // shadcn's components import through `@/` (components.json), which
  // tsconfig.json's `paths` maps to `src/`.
  resolve: { tsconfigPaths: true },
});
