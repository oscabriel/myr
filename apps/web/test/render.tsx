// The view itself is the root's component: it renders whatever the address, and a page's own route never runs.
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

import { addressRewrite, projectParams } from "../src/server/addresses.ts";

export interface RenderOptions {
  readonly rail?: ComponentType;
}

const routesFor = (view: ReactNode, options: RenderOptions) => {
  const root = createRootRoute({ component: () => view });

  const project = createRoute({
    getParentRoute: () => root,
    params: projectParams,
    path: "$owner/$project",
  });

  return root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: "/",
      staticData: { shell: "bare" },
    }),
    createRoute({ getParentRoute: () => root, path: "asks" }),
    createRoute({ getParentRoute: () => root, path: "home" }),
    createRoute({ getParentRoute: () => root, path: "import" }),
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

export const routerAt = (
  url: string,
  view: ReactNode = null,
  options: RenderOptions = {}
) =>
  createRouter({
    history: createMemoryHistory({ initialEntries: [url] }),
    rewrite: addressRewrite,
    routeTree: routesFor(view, options),
  });

export const renderAt = (
  url: string,
  view: ReactNode,
  options: RenderOptions = {}
): Effect.Effect<string, Cause.UnknownError> => {
  const router = routerAt(url, view, options);

  return Effect.tryPromise(() => router.load()).pipe(
    Effect.map(() => renderToStaticMarkup(<RouterProvider router={router} />))
  );
};
