import { createRouter } from "@tanstack/react-router";

import {
  NotFoundPage,
  PendingPage,
  RouteError,
} from "./features/shared/pending.tsx";
import { routeTree } from "./routeTree.gen.ts";
import { addressRewrite } from "./server/addresses.ts";

/**
 * TanStack Start's router, over the route tree the Vite plugin generates.
 *
 * - A link (`AppLink`) fetches its page's code and loader data once a
 *   pointer rests on it for 50 ms (the router's own delay, stated) or it
 *   takes focus, and what it read stays fresh for 30 s, so a click soon
 *   after reads nothing again. A page left and come back to within 10 s is
 *   drawn from what it read; later, it is drawn so and read again behind
 *   it. A page's own reads stay live through its atoms either way.
 * - A page that takes longer than 300 ms to load shows `PendingPage` in the
 *   shell; a quicker one never flashes it.
 * - A failed read draws `RouteError` and an address no page serves draws
 *   `NotFoundPage`, both inside the shell, never the router's own.
 * - Each new page's main pane (and its inspector) starts at its top; going
 *   back returns each to where it was.
 * - A project at its source path (`/github.com/pallets/click`) is read by
 *   the same pages as `/oscabriel/datekit` (`addressRewrite`).
 */
export const getRouter = () =>
  createRouter({
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFoundPage,
    defaultPendingComponent: PendingPage,
    defaultPendingMs: 300,
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 30_000,
    defaultStaleTime: 10_000,
    rewrite: addressRewrite,
    routeTree,
    scrollRestoration: true,
    scrollToTopSelectors: ["#main", "#facts"],
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
