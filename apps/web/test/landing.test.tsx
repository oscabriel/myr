/**
 * The landing, as a first-time reader meets it: what the platform is, the
 * way to the open asks before anything else, the install line to copy, the
 * screen `git push` prints when the gate refuses (from the one renderer),
 * the four nouns, the loop, and the projects to read, each with its
 * posture. Drawn in the house style: no banned word, and no rounded,
 * shadowed or gradient surface. Its projects are read on the server as
 * nobody, so the page is the same for everyone, script or not.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Effect, Schema } from "effect";

import { LandingView } from "../src/features/landing/landing-page.tsx";
import {
  LandingProjects,
  PROJECTS_SHOWN,
} from "../src/features/landing/projects.ts";
import { readLandingProjects } from "../src/features/landing/read.ts";
import { LEDE } from "../src/features/landing/words.ts";
import { landingHead } from "../src/routes/index.tsx";
import { textIn } from "./markup.ts";
import { platformWith, unreachablePlatform } from "./platform.ts";
import { renderAt } from "./render.tsx";

const PLATFORM = "https://platform.example.workers.dev";

const WEB = "https://web.example.workers.dev";

const listed = LandingProjects.cases.Listed.make({
  projects: Schema.decodeSync(Schema.Array(ProjectListing))([
    { openAsks: 2, posture: "openWithSealedEvidence", project: "datekit" },
    { openAsks: 6, posture: "open", project: "burrow" },
  ]),
});

const pageWith = (projects: LandingProjects) =>
  renderAt(
    "/",
    <LandingView platformUrl={PLATFORM} projects={projects} webUrl={WEB} />
  );

/** Every link's address, in the page's order. */
const hrefsOf = (markup: string) =>
  [...markup.matchAll(/<a\b[^>]*href="(?<href>[^"]+)"/gu)].map(
    (found) => found.groups?.href
  );

describe(LandingView, () => {
  it.effect(
    "leads with what the platform is, then the open asks, then the install line to copy",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(listed);
        const main = markup.slice(markup.indexOf("<main"));
        const text = textIn(main);

        expect(text).toContain(
          "A Git platform for the boundary between a project and everyone else."
        );
        // The first link in the page's body is to the open asks.
        expect(hrefsOf(main)[0]).toBe("/asks");
        expect(main).toMatch(/data-action="asks"[^>]*>See the open asks</u);
        expect(text).toContain(`curl -fsSL ${WEB}/install.sh | sh`);
      })
  );

  it.effect(
    "shows the refusal as git prints it, with the platform's own lines and the rejected ref",
    () =>
      Effect.gen(function* () {
        const text = textIn(yield* pageWith(listed));

        expect(text).toContain(
          "remote: OutOfScope: changes paths outside the ask's territory: README.md"
        );
        expect(text).toContain(`remote:   next: ${Brand.cli} check`);
        expect(text).toContain(
          " ! [remote rejected] HEAD -> main (OutOfScope)"
        );
        expect(text).toContain(`To ${PLATFORM}/datekit--parse-iso--alice.git`);
        expect(text).toContain("The gate refuses in git's own output.");
      })
  );

  it.effect("names the four nouns, and the loop in six lines", () =>
    Effect.gen(function* () {
      const markup = yield* pageWith(listed);

      expect(
        [...markup.matchAll(/data-noun="(?<noun>[^"]+)"/gu)].map(
          (found) => found.groups?.noun
        )
      ).toStrictEqual(["ask", "answer", "check", "refusal"]);
      expect(
        markup
          .slice(markup.indexOf('aria-labelledby="loop"'))
          .split("</ol>")[0]
          ?.match(/<li\b/gu)
      ).toHaveLength(6);
    })
  );

  it.effect(
    "lists the projects to read, each linking its home with its posture, and every ask",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(listed);

        expect(hrefsOf(markup)).toStrictEqual(
          expect.arrayContaining(["/datekit", "/burrow", "/asks"])
        );
        expect(markup).toMatch(
          /data-project="datekit"[\s\S]*?data-posture="openWithSealedEvidence"/u
        );
        expect(markup).toMatch(
          /data-project="burrow"[\s\S]*?data-posture="open"/u
        );
        // The posture badge, with its mark, not the word alone.
        expect(
          markup
            .slice(markup.indexOf('data-project="datekit"'))
            .split("</li>")[0]
        ).toContain("<svg");
      })
  );

  it("unfurls with its own sentence, the README's lede", () => {
    expect(landingHead().meta).toContainEqual({
      content: LEDE,
      name: "description",
    });
  });

  it.effect(
    "says so when the projects did not come, and still leads to the asks",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(
          LandingProjects.cases.Unreachable.make({})
        );

        expect(textIn(markup)).toContain("The platform did not answer.");
        expect(hrefsOf(markup)).toContain("/asks");
      })
  );

  it.effect(
    "uses no banned word, and no rounded, shadowed or gradient surface",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(listed);
        const text = textIn(markup).toLowerCase();

        // DESIGN.md's list, and the glossary's words to avoid. "Merge" is
        // banned for a landing, and the page never says it of one ("merges
        // onto main" is the gate's step, in the README's words).
        expect(
          [
            "review",
            "approve",
            "issue",
            "pull request",
            "lease",
            "reputation",
            "inbox",
            "queue",
            "dashboard",
            "explore",
            "trending",
          ].filter((word) => text.includes(word))
        ).toStrictEqual([]);
        expect(textIn(markup)).not.toMatch(/\bPRs?\b/u);
        expect(
          [...markup.matchAll(/class="(?<names>[^"]*)"/gu)].flatMap((found) =>
            (found.groups?.names ?? "")
              .split(" ")
              // `rounded-none` (the shared buttons') takes rounding away.
              .filter((name) =>
                /^(?:rounded-(?!none$)|shadow|bg-gradient)/u.test(name)
              )
          )
        ).toStrictEqual([]);
      })
  );
});

/** A platform that lists `projects`, and answers nothing else. */
const listing = (projects: readonly ProjectListing[]) =>
  platformWith(
    Contracts.toLayerHandler("listProjects", () => Effect.succeed({ projects }))
  );

describe("the landing's projects, read on the server", () => {
  const many = Schema.decodeSync(Schema.Array(ProjectListing))(
    Array.from({ length: PROJECTS_SHOWN + 2 }, (_, at) => ({
      openAsks: 1,
      posture: "open",
      project: `project-${at}`,
    }))
  );

  it.effect("names the first eight projects the platform lists", () =>
    Effect.gen(function* () {
      const read = yield* readLandingProjects.pipe(
        Effect.provide(listing(many))
      );

      expect(
        LandingProjects.match(read, {
          Listed: ({ projects }) => projects.map(({ project }) => project),
          Unreachable: () => [],
        })
      ).toStrictEqual(
        many.slice(0, PROJECTS_SHOWN).map(({ project }) => project)
      );
    })
  );

  it.effect("says so, and never fails, when the platform did not answer", () =>
    Effect.gen(function* () {
      const read = yield* readLandingProjects.pipe(
        Effect.provide(unreachablePlatform)
      );

      expect(read._tag).toBe("Unreachable");
    })
  );
});
