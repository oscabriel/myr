/**
 * A view rendered to HTML inside a router, at an address: what a view that
 * draws the router's links (`AppLink`), reads the location or the route's
 * params needs around it, as the app's router gives it in the browser.
 *
 * The routes are the app's shape without its loaders: `/` (the landing,
 * outside the shell), `/asks`, `/home`, `/today`, `/docs`, `/docs/$page`,
 * `/agents`, `/people/$handle` and `/$project` with its pages under it, so
 * the shell finds the project in `/datekit/ledger` and none in `/agents`.
 * The view itself is the root's component: it renders whatever the
 * address, and a page's own route never runs.
 *
 * ```tsx
 * it.effect("…", () =>
 *   Effect.gen(function* () {
 *     const markup = yield* renderAt("/datekit/ledger", <AppShell>…</AppShell>);
 *   })
 * );
 * ```
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Effect } from "effect";
import type { Cause } from "effect";
import type { ComponentType, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** What a test may add to the routes: the rail's content on a project's pages. */
export interface RenderOptions {
  readonly rail?: ComponentType;
}

const routesFor = (view: ReactNode, options: RenderOptions) => {
  const root = createRootRoute({ component: () => view });
  const project = createRoute({ getParentRoute: () => root, path: "$project" });

  return root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: "/",
      staticData: { shell: "bare" },
    }),
    createRoute({ getParentRoute: () => root, path: "asks" }),
    createRoute({ getParentRoute: () => root, path: "home" }),
    createRoute({ getParentRoute: () => root, path: "today" }),
    createRoute({ getParentRoute: () => root, path: "docs" }),
    createRoute({ getParentRoute: () => root, path: "docs/$page" }),
    createRoute({ getParentRoute: () => root, path: "agents" }),
    createRoute({ getParentRoute: () => root, path: "people/$handle" }),
    project.addChildren([
      createRoute({ getParentRoute: () => project, path: "/" }),
      options.rail === undefined
        ? createRoute({ getParentRoute: () => project, path: "$" })
        : createRoute({
            getParentRoute: () => project,
            path: "$",
            staticData: { rail: options.rail },
          }),
    ]),
  ]);
};

/** `view`'s static markup inside a router whose location is `url`. */
export const renderAt = (
  url: string,
  view: ReactNode,
  options: RenderOptions = {}
): Effect.Effect<string, Cause.UnknownError> => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [url] }),
    routeTree: routesFor(view, options),
  });

  return Effect.tryPromise(() => router.load()).pipe(
    Effect.map(() => renderToStaticMarkup(<RouterProvider router={router} />))
  );
};
