/**
 * A person's page, rendered to HTML with `react-dom/server` from fixtures
 * decoded with the protocol's own schemas: their credit by project, area
 * and role, counted, and never ranked.
 */
import { describe, expect, it } from "@effect/vitest";
import { CreditSummary } from "@repo/protocol/domain/record";
import { Handle } from "@repo/protocol/ids";
import { Schema } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PersonView } from "../src/features/people/person-page.tsx";
import { reachingTransport } from "./transport.ts";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (element: ReactElement) =>
  markupOf(element)
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");

const handle = Schema.decodeSync(Handle)("ines-v");

const credits = Schema.decodeSync(Schema.Array(CreditSummary))([
  { area: "core", count: 4, project: "datekit", role: "Signed-off-by" },
  { area: "docs", count: 1, project: "datekit", role: "Signed-off-by" },
  { area: "format", count: 1, project: "burrow", role: "Finished-by" },
  { area: "core", count: 2, project: "datekit", role: "Asked-by" },
]);

const page = <PersonView credits={credits} handle={handle} />;

/** Each group heading's text, top to bottom: projects as `h2`, areas as `h3`. */
const headingsOf = (element: ReactElement) =>
  [
    ...markupOf(element).matchAll(
      /<(?<level>h[23])\b[^>]*>(?<text>.*?)<\/h[23]>/gu
    ),
  ].map(
    ({ groups }) =>
      `${groups?.level}:${groups?.text?.replaceAll(/<[^>]+>/gu, "")}`
  );

describe(PersonView, () => {
  it("groups credit by project, then by area", () => {
    expect(headingsOf(page)).toStrictEqual([
      "h2:burrow",
      "h3:format",
      "h2:datekit",
      "h3:core",
      "h3:docs",
    ]);
  });

  it("lists the roles in each area with their counts, in trailer order", () => {
    const text = textOf(page);
    const core = text.slice(text.indexOf("core"), text.indexOf("docs"));

    expect(core.indexOf("Asked-by")).toBeGreaterThanOrEqual(0);
    expect(core.indexOf("Signed-off-by")).toBeGreaterThan(
      core.indexOf("Asked-by")
    );
    expect(core).toMatch(/Asked-by\D*2 landings/u);
    expect(core).toMatch(/Signed-off-by\D*4 landings/u);
    expect(text).toMatch(/Finished-by\D*1 landing(?!s)/u);
  });

  it("links each project to its page", () => {
    expect(markupOf(page)).toContain('href="/datekit"');
    expect(markupOf(page)).toContain('href="/burrow"');
  });

  it("never reads as a score", () => {
    const markup = markupOf(page).toLowerCase();

    for (const word of ["score", "rank", "points", "reputation"]) {
      expect(markup).not.toContain(word);
    }
  });

  it("says a person with no credit has none yet", () => {
    expect(textOf(<PersonView credits={[]} handle={handle} />)).toContain(
      "No credited landings yet"
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
