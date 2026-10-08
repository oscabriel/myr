import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Cloudflare framework guide's order: the Worker runs TanStack Start's
// SSR environment, and Start comes before React. `vite build` picks the
// stage from `CLOUDFLARE_ENV` (infra/deploy.ts sets it).
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  // shadcn's components import through `@/` (components.json), which
  // tsconfig.json's `paths` maps to `src/`.
  resolve: { tsconfigPaths: true },
});
