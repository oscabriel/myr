import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { CreditSummary } from "@repo/protocol/domain/record";
import { Handle } from "@repo/protocol/ids";
import { isNotFound } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import type { ReactElement } from "react";

import {
  areaSentence,
  NoSuchPersonView,
  PersonView,
} from "../src/features/people/person-page.tsx";
import { readPersonPage } from "../src/routes/people/$handle.tsx";
import { platformWith, unreachablePlatform } from "./platform.ts";
import { renderAt } from "./render.tsx";
import { reachingTransport } from "./transport.ts";

const handle = Schema.decodeSync(Handle)("ines-v");

const credits = Schema.decodeSync(Schema.Array(CreditSummary))([
  { area: "core", count: 4, project: "datekit", role: "Signed-off-by" },
  { area: "docs", count: 1, project: "datekit", role: "Signed-off-by" },
  { area: "format", count: 1, project: "burrow", role: "Finished-by" },
  { area: "core", count: 2, project: "datekit", role: "Asked-by" },
  { area: ".", count: 7, project: "burrow", role: "Decided-by" },
  { area: "core", count: 12, project: "datekit", role: "Signed-off-by" },
]);

const markupOf = (element: ReactElement) =>
  renderAt(`/people/${handle}`, element);

const textOf = (html: string) =>
  html
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");

const creditsOf = (html: string) => {
  const start = html.indexOf('data-credits=""');
  const end = html.indexOf("</main>", start);

  expect(start).toBeGreaterThanOrEqual(0);

  return html.slice(start, end);
};

const page = markupOf(<PersonView credits={credits} handle={handle} />);

describe("a person's page", () => {
  it.effect("is titled with the handle, and has no inspector", () =>
    Effect.gen(function* () {
      const html = yield* page;

      expect(html).toMatch(/<h1\b[^>]*>ines-v<\/h1>/u);
      expect(html).not.toContain('data-facts="inspector"');
      expect(html).not.toContain("<img");
    })
  );

  it.effect("groups credit by project, each area one sentence of roles", () =>
    Effect.gen(function* () {
      const html = creditsOf(yield* page);

      const groups = [...html.matchAll(/<h2\b[^>]*>(?<name>.*?)<\/h2>/gu)].map(
        ({ groups: found }) => textOf(found?.name ?? "")
      );

      expect(groups).toStrictEqual(["oscabriel/burrow", "oscabriel/datekit"]);

      const sentences = [
        ...html.matchAll(/data-area="(?<area>[^"]*)"[^>]*>/gu),
      ].map(({ groups: found }) => found?.area);

      expect(sentences).toStrictEqual([".", "format", "core", "docs"]);

      const text = textOf(html);

      for (const sentence of [
        "Decided in the whole project",
        "Finished in oscabriel/burrow/format",
        "Answered and asked in oscabriel/datekit/core",
        "Answered in oscabriel/datekit/docs",
      ]) {
        expect(text).toContain(sentence);
      }
    })
  );

  it.effect("links each project, and each area to the project's landings", () =>
    Effect.gen(function* () {
      const html = creditsOf(yield* page);

      for (const project of ["oscabriel/datekit", "oscabriel/burrow"]) {
        expect(html).toContain(`href="/${project}"`);
        expect(html).toContain(`href="/${project}/commits/main?show=landings"`);
      }
    })
  );

  it.effect("draws no number in its credits, whatever the read counts", () =>
    Effect.gen(function* () {
      const html = yield* page;

      expect(textOf(creditsOf(html))).not.toMatch(/\d/u);
      expect(html).not.toMatch(
        /\b(?:landings?|credits?)\b\s*\d|\d+\s*(?:landings?|credits?)\b/iu
      );
    })
  );

  it.effect("says credit is the trailers, and nothing on it is a score", () =>
    Effect.gen(function* () {
      const text = textOf(yield* page);

      expect(text).toContain(
        "Credit is the trailers on each landing; nothing here is a score."
      );

      for (const word of ["rank", "points", "reputation"]) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    })
  );

  it.effect(
    "says a person with no credit has none yet, with a way onward",
    () =>
      Effect.gen(function* () {
        const html = yield* markupOf(
          <PersonView credits={[]} handle={handle} />
        );

        expect(textOf(html)).toContain("No credited landings yet.");
        expect(html).toContain('href="/asks"');
      })
  );
});

describe("the person's route", () => {
  const encodedCredits = Schema.encodeSync(Schema.Array(CreditSummary))(
    credits
  );

  const platform = platformWith(
    Contracts.toLayerHandler("credits", (payload) =>
      Effect.succeed({ credits: payload.handle === handle ? credits : [] })
    )
  );

  it.effect(
    "reads the credits in its loader, so the page arrives with them",
    () =>
      Effect.gen(function* () {
        const read = yield* readPersonPage("ines-v").pipe(
          Effect.provide(platform)
        );

        expect(read.handle).toBe("ines-v");
        expect(read.credits).toStrictEqual(encodedCredits);
      })
  );

  it.effect(
    "is not found for an address that names no handle, before any read",
    () =>
      Effect.gen(function* () {
        const refused = yield* Effect.flip(
          readPersonPage("-not-a-handle").pipe(
            Effect.provide(unreachablePlatform)
          )
        );

        expect(isNotFound(refused)).toBeTruthy();
      })
  );

  it.effect(
    "draws the not-found page as a project's: titled, with a crumb and a way onward",
    () =>
      Effect.gen(function* () {
        const html = yield* renderAt(
          "/people/-not-a-handle",
          <NoSuchPersonView />
        );

        expect(html).toMatch(/<h1\b[^>]*>No such person<\/h1>/u);
        expect(html).toContain("this address names none");
        expect(html).toContain('href="/asks"');
      })
  );
});

describe("an area's sentence", () => {
  it("names the roles in words, the answer first, then in trailer order", () => {
    expect(
      areaSentence("datekit", "src", [
        "Asked-by",
        "Signed-off-by",
        "Decided-by",
      ])
    ).toBe("Answered, asked and decided in datekit/src");
  });

  it("reads the whole project for an area of '.'", () => {
    expect(areaSentence("datekit", ".", ["Mentored-by"])).toBe(
      "Mentored in the whole project"
    );
  });
});

describe("the person's views", () => {
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/people/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  it("import no transport", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(1);
    expect(reachingTransport(sources)).toStrictEqual([]);
  });
});
