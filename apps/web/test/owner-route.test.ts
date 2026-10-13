import { describe, expect, it } from "@effect/vitest";
import { reservedProjectNames } from "@repo/protocol/ids";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { getRouter } from "../src/router.tsx";
import {
  ownerLoader,
  Route as OwnerRoute,
} from "../src/routes/$owner/index.tsx";
import { Route as ExploreRoute } from "../src/routes/explore.tsx";
import { Route as ImportRoute } from "../src/routes/import.tsx";

interface Outcome {
  readonly location?: string | null;
  readonly notFound: boolean;
  readonly status?: number;
}

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

  it.effect(
    "reaches its own page for the top bar's /explore, never a person's",
    () =>
      Effect.gen(function* () {
        expect(routeAt("/explore")).toBe(ExploreRoute);
        expect(yield* outcomeFor("explore")).toStrictEqual({ notFound: true });
      })
  );
});
