import { fileURLToPath } from "node:url";

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

/** Shiki's WebAssembly, as the Worker's build resolves it: nothing. */
const NO_WASM = "\0worker-no-shiki-wasm";

/** What the Worker's build resolves in place of a package entry, by the entry. */
const WORKER_IN_PLACE = new Map([
  ["@pierre/theming/themes", "src/server/pierre-themes.ts"],
  ["shiki", "src/server/shiki.ts"],
]);

/**
 * The Worker's Shiki: core and the JavaScript engine alone
 * (`src/server/shiki.ts`), with no theme collection
 * (`src/server/pierre-themes.ts`), so the server's highlighting bundles
 * only the grammars it names: never Shiki's map of every grammar (about
 * 10 MB) and theme, Pierre's themes, or Shiki's WebAssembly, which a
 * Worker cannot compile. The browser's build keeps the whole packages;
 * their grammars and themes are chunks fetched only when used.
 */
const workerShiki = (): Plugin => ({
  applyToEnvironment: (environment) => environment.name === "ssr",
  enforce: "pre",
  load: (id) => (id === NO_WASM ? "export default undefined;" : undefined),
  name: "worker-shiki",
  resolveId: (id) => {
    const inPlace = WORKER_IN_PLACE.get(id);

    if (inPlace !== undefined) {
      return fileURLToPath(new URL(inPlace, import.meta.url));
    }

    return id === "shiki/wasm" ? NO_WASM : undefined;
  },
});

// The Cloudflare framework guide's order: the Worker runs TanStack Start's
// SSR environment, and Start comes before React. `vite build` picks the
// stage from `CLOUDFLARE_ENV` (infra/deploy.ts sets it).
export default defineConfig(({ mode }) => {
  // This machine's Caddy name for the dev server, from the gitignored
  // `apps/web/.env.development.local`, which Vite reads in dev and Wrangler
  // never loads as a Worker secret; without one, the dev server answers on
  // 127.0.0.1 alone.
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
      workerShiki(),
    ],
    // shadcn's components import through `@/` (components.json), which
    // tsconfig.json's `paths` maps to `src/`.
    resolve: { tsconfigPaths: true },
    server,
    // The Worker's own code is minified like the browser's: about a third
    // of its bytes. Its source maps go up with each deploy
    // (`upload_source_maps` in wrangler.jsonc), so a stack trace in the
    // Worker's logs still names the source.
    environments: { ssr: { build: { minify: true, sourcemap: true } } },
  };
});
