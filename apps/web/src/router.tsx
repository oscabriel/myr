import { createRouter } from "@tanstack/react-router";

import {
  NotFoundPage,
  PendingPage,
  RouteError,
} from "./features/shared/pending.tsx";
import { routeTree } from "./routeTree.gen.ts";
import { addressRewrite } from "./server/addresses.ts";

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
