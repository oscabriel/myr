import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen.ts";

/** TanStack Start's router, over the route tree the Vite plugin generates. */
export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
