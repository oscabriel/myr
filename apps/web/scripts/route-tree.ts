// Writes `src/routeTree.gen.ts` without a build: resolving the Vite config runs the TanStack Start plugin's generator.
// The tree is not committed, so typecheck, check and fix run this first.
import { resolveConfig } from "vite";

await resolveConfig(
  {
    logLevel: "silent",
    root: new URL("..", import.meta.url).pathname,
  },
  "build"
);
