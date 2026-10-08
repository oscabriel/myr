/**
 * Writes `src/routeTree.gen.ts`, TanStack Router's generated route tree,
 * without a build: resolving the Vite config runs the TanStack Start plugin's
 * generator (its `configResolved` hook), and writes nothing else.
 *
 * The tree is never committed (the route issues run in parallel and would
 * conflict on it), so whatever reads the app's types generates it first:
 * this package's `typecheck`, and the root's `check` and `fix`, whose lint is
 * type-aware.
 */
import { resolveConfig } from "vite";

await resolveConfig(
  {
    logLevel: "silent",
    root: new URL("..", import.meta.url).pathname,
  },
  "build"
);
