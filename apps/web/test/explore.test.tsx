import { describe, expect, it } from "@effect/vitest";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { DateTime, Effect, Schema } from "effect";

import { ExploreView } from "../src/features/explore/explore-page.tsx";
import { exploreGroups } from "../src/features/explore/groups.ts";
import { LandingProjects } from "../src/features/landing/projects.ts";
import { readEveryProject } from "../src/features/landing/read.ts";
import { exploreHeaders, Route } from "../src/routes/explore.tsx";
import { fixturesClient } from "./dev-client.ts";
import { TEN_LISTED } from "./listings.ts";
import { textIn } from "./markup.ts";
import { unreachablePlatform } from "./platform.ts";
import { renderAt } from "./render.tsx";

const DATEKIT_LINE =
  "Small, dependency-free date helpers: parse, format, add and diff.";

const listedIn = (read: LandingProjects) =>
  LandingProjects.match(read, {
    Listed: ({ projects }) => projects,
    Unreachable: () => [],
  });

const decodeListing = Schema.decodeSync(ProjectListing);

const at = (iso: string) => DateTime.makeUnsafe(iso);

/** An import adopted from its source, landed on and taking no answers. */
const click = decodeListing({
  description: "Python composable command line interface toolkit.",
  landedAt: "2026-10-12T09:00:00.000Z",
  openAsks: 0,
  posture: "open",
  project: "github.com/pallets/click",
});

/** Markup before and after the group of projects taking no answers. */
const groupsIn = (markup: string) => {
  const [taking = "", rest = ""] = markup.split('data-group="rest"');

  return { rest, taking };
};

const explored = (projects: readonly ProjectListing[]) =>
  renderAt(
    "/explore",
    <ExploreView projects={LandingProjects.cases.Listed.make({ projects })} />
  );

describe("Explore, read on the server", () => {
  it.live(
    "lists datekit with its README's first paragraph as its description",
    () =>
      Effect.gen(function* () {
        const projects = listedIn(yield* readEveryProject);

        expect(
          projects.find(({ project }) => project === "oscabriel/datekit")
            ?.description
        ).toBe(DATEKIT_LINE);
      }).pipe(Effect.provide(fixturesClient()), Effect.scoped),
    60_000
  );

  it.effect("is unreachable, never a failed page, when the platform is", () =>
    Effect.gen(function* () {
      const read = yield* readEveryProject.pipe(
        Effect.provide(unreachablePlatform)
      );

      expect(read._tag).toBe("Unreachable");
    })
  );

  it("is one page for every reader, which the edge may keep", () => {
    expect(Route.options.headers).toBe(exploreHeaders);
    expect(exploreHeaders()).toStrictEqual({
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
    });
  });
});

describe(exploreGroups, () => {
  it("puts the projects taking answers first, each group by its latest landing", () => {
    const { rest, taking } = exploreGroups([
      {
        openAsks: 2,
        posture: "open",
        project: ProjectName.make("oscabriel/alpha"),
      },
      {
        landedAt: at("2026-10-12T08:00:00Z"),
        openAsks: 1,
        posture: "open",
        project: ProjectName.make("oscabriel/datekit"),
      },
      {
        landedAt: at("2026-10-12T10:00:00Z"),
        openAsks: 0,
        posture: "open",
        project: ProjectName.make("oscabriel/zeta"),
      },
      {
        landedAt: at("2026-10-12T11:00:00Z"),
        openAsks: 4,
        posture: "open",
        project: ProjectName.make("oscabriel/burrow"),
      },
    ]);

    expect(taking.map(({ project }) => project)).toStrictEqual([
      "oscabriel/burrow",
      "oscabriel/datekit",
      "oscabriel/alpha",
    ]);
    expect(rest.map(({ project }) => project)).toStrictEqual([
      "oscabriel/zeta",
    ]);
  });
});

describe(ExploreView, () => {
  it.live(
    "draws datekit and burrow under taking answers now, and an import after them",
    () =>
      Effect.gen(function* () {
        const projects = listedIn(yield* readEveryProject);

        const { rest, taking } = groupsIn(
          yield* explored([...projects, click])
        );

        expect(textIn(taking)).toContain("Taking answers now");
        expect(taking).toContain('data-project="oscabriel/datekit"');
        expect(taking).toContain('data-project="oscabriel/burrow"');
        expect(rest).toContain('data-project="github.com/pallets/click"');
        expect(rest).not.toContain('data-project="oscabriel/datekit"');
      }).pipe(Effect.provide(fixturesClient()), Effect.scoped),
    60_000
  );

  it.effect(
    "shows a card's full name, description, posture, open asks and last landing",
    () =>
      Effect.gen(function* () {
        const datekit = decodeListing({
          description: DATEKIT_LINE,
          landedAt: "2026-10-12T09:00:00.000Z",
          openAsks: 3,
          posture: "openWithSealedEvidence",
          project: "oscabriel/datekit",
        });

        const [, card = ""] = (yield* explored([datekit])).split(
          'data-project="oscabriel/datekit"'
        );

        expect(textIn(card)).toContain("oscabriel/datekit");
        expect(textIn(card)).toContain(DATEKIT_LINE);
        expect(card).toContain('data-posture="openWithSealedEvidence"');
        expect(textIn(card)).toContain("3 open asks");
        expect(textIn(card)).toContain("Last landed Oct 12, 2026");
      })
  );

  it.effect(
    "says when no project takes answers, and when a project has not landed",
    () =>
      Effect.gen(function* () {
        const markup = yield* explored([
          {
            openAsks: 0,
            posture: "open",
            project: ProjectName.make("oscabriel/zeta"),
          },
        ]);

        expect(textIn(markup)).toContain(
          "No project has an open ask right now."
        );
        expect(textIn(markup)).toContain("No open asks");
        expect(textIn(markup)).toContain("No landing yet");
      })
  );

  it.effect("links each project to its own page under its full name", () =>
    Effect.gen(function* () {
      const markup = yield* explored(TEN_LISTED);

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
