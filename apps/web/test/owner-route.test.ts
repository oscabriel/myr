/**
 * An owner's address alone: `/<handle>` leads to the person's
 * page, `/people/<handle>`, by a 302 (a handle may yet become a page of its
 * own); an owner that is no handle, a source host among them, is not
 * found. The route's own loader is run inside a router in memory, as the
 * server runs it.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Effect } from "effect";

import { ownerLoader } from "../src/routes/$owner/index.tsx";

/** The router at `url`, its tree the owner's route and the person's page. */
const loadedAt = (url: string) => {
  const root = createRootRoute();

  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [url] }),
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "people/$handle" }),
      createRoute({
        getParentRoute: () => root,
        loader: ownerLoader,
        path: "$owner",
      }),
    ]),
  });

  // What the server's load chose, which Start answers the request with: a
  // redirect, or a render at its status.
  return Effect.map(
    Effect.promise(() => router.load()),
    () => router._serverResult
  );
};

describe("an owner's address alone", () => {
  it.effect("is a 302 to the person's page when it names a handle", () =>
    Effect.gen(function* () {
      const result = yield* loadedAt("/oscabriel");
      const redirect = result?.type === "redirect" ? result.redirect : null;

      expect(redirect?.status).toBe(302);
      expect(redirect?.headers.get("location")).toBe("/people/oscabriel");
    })
  );

  it.effect.each(["/github.com", "/gitlab.com", "/not_a.handle"])(
    "%s is not found",
    (path) =>
      Effect.gen(function* () {
        expect(yield* loadedAt(path)).toMatchObject({
          status: 404,
          type: "render",
        });
      })
  );
});
