import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { Effect } from "effect";

import { ExploreView } from "../src/features/explore/explore-page.tsx";
import { LandingProjects } from "../src/features/landing/projects.ts";
import { readEveryProject } from "../src/features/landing/read.ts";
import { EIGHT_LEADING, TEN_LISTED } from "./listings.ts";
import { textIn } from "./markup.ts";
import { platformWith, unreachablePlatform } from "./platform.ts";
import { renderAt } from "./render.tsx";

const listing = platformWith(
  Contracts.toLayerHandler("listProjects", () =>
    Effect.succeed({ projects: TEN_LISTED })
  )
);

const namesOf = (read: LandingProjects) =>
  LandingProjects.match(read, {
    Listed: ({ projects }) => projects.map(({ project }) => project),
    Unreachable: () => [],
  });

describe("Explore, read on the server", () => {
  it.effect(
    "names every public project, the most open asks first and a tie by name",
    () =>
      Effect.gen(function* () {
        const names = namesOf(
          yield* readEveryProject.pipe(Effect.provide(listing))
        );

        expect(names).toHaveLength(TEN_LISTED.length);
        expect(names.slice(0, EIGHT_LEADING.length)).toStrictEqual(
          EIGHT_LEADING
        );
      })
  );

  it.effect("is unreachable, never a failed page, when the platform is", () =>
    Effect.gen(function* () {
      const read = yield* readEveryProject.pipe(
        Effect.provide(unreachablePlatform)
      );

      expect(read._tag).toBe("Unreachable");
    })
  );
});

describe(ExploreView, () => {
  it.effect("links each project to its own page under its full name", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt(
        "/explore",
        <ExploreView
          projects={LandingProjects.cases.Listed.make({
            projects: TEN_LISTED,
          })}
        />
      );

      const hrefs = [
        ...markup.matchAll(/<a\b[^>]*href="(?<href>[^"]+)"[^>]*>/gu),
      ].flatMap(({ groups }) => groups?.href ?? []);

      expect(textIn(markup)).toContain("Explore");
      expect(hrefs).toStrictEqual(
        expect.arrayContaining(TEN_LISTED.map(({ project }) => `/${project}`))
      );
    })
  );
});
