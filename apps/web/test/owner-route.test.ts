/**
 * An owner's address alone: `/<handle>` leads to the person's page,
 * `/people/<handle>` in lowercase (handles compare without case), by a 302
 * (a handle may yet become a page of its own); an owner that is no handle,
 * a source host among them, and a word the web keeps for itself are not
 * found. The app's own router reaches the route for `/<handle>` and still
 * reaches its own pages by their words.
 */
import { describe, expect, it } from "@effect/vitest";
import { reservedProjectNames } from "@repo/protocol/ids";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { getRouter } from "../src/router.tsx";
import {
  ownerLoader,
  Route as OwnerRoute,
} from "../src/routes/$owner/index.tsx";
import { Route as ImportRoute } from "../src/routes/import.tsx";

/** What the loader's load came to for `owner`: a redirect, a 404, or neither. */
interface Outcome {
  readonly location?: string | null;
  readonly notFound: boolean;
  readonly status?: number;
}

/** What the route's loader rejects with for `owner`, as an outcome. */
const outcomeFor = (owner: string) =>
  Effect.tryPromise({
    catch: (thrown): Outcome =>
      isRedirect(thrown)
        ? {
            location: thrown.headers.get("location"),
            notFound: false,
            status: thrown.status,
          }
        : { notFound: isNotFound(thrown) },
    try: () => ownerLoader({ params: { owner } }),
  }).pipe(Effect.flip);

/** The route the app's own tree finds for `pathname`. */
const routeAt = (pathname: string) => getRouter().getMatchedRoutes(pathname)[2];

describe("an owner's address alone", () => {
  it.effect(
    "is a 302 to the person's page, in lowercase, when it names a handle",
    () =>
      Effect.gen(function* () {
        const toPerson = {
          location: "/people/oscabriel",
          notFound: false,
          status: 302,
        };

        expect(yield* outcomeFor("oscabriel")).toStrictEqual(toPerson);
        expect(yield* outcomeFor("OscaBriel")).toStrictEqual(toPerson);
      })
  );

  it.effect.each(["github.com", "gitlab.com", "not_a.handle"])(
    "%s is not found",
    (owner) =>
      Effect.gen(function* () {
        expect(yield* outcomeFor(owner)).toStrictEqual({ notFound: true });
      })
  );

  it.effect(
    "is not found for every word the web keeps, never a person's page",
    () =>
      Effect.gen(function* () {
        const outcomes = yield* Effect.forEach(
          [...reservedProjectNames, "Icons"],
          outcomeFor
        );

        expect(outcomes.filter(({ notFound }) => !notFound)).toStrictEqual([]);
      })
  );
});

describe("the app's router", () => {
  it("reaches the owner's route for /<handle>, and its own page for /import", () => {
    expect(routeAt("/oscabriel")).toBe(OwnerRoute);
    expect(routeAt("/import")).toBe(ImportRoute);
  });
});
