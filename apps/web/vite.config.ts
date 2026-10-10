import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import type { Plugin, ServerOptions } from "vite";

import {
  MANIFEST_PATH,
  webManifestText,
} from "./src/features/agents/manifest.ts";

/**
 * The web app manifest, made from `Brand.name` rather than kept
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
export default defineConfig(({ mode }) => {
  // This machine's Caddy name for the dev server, from the gitignored
  // `apps/web/.env`; without one, the dev server answers on localhost alone.
  const caddyDevHost = loadEnv(mode, process.cwd(), "").CADDY_DEV_HOST;

  const server: ServerOptions = {
    host: "127.0.0.1",
    port: 3032,
    strictPort: true,
  };

  if (caddyDevHost !== undefined && caddyDevHost !== "") {
    server.allowedHosts = ["localhost", "127.0.0.1", caddyDevHost];
    server.hmr = { clientPort: 443, host: caddyDevHost, protocol: "wss" };
  }

  return {
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
    server,
  };
});
