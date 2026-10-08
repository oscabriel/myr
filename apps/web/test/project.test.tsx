/**
 * A project's page, rendered to HTML with `react-dom/server` from fixtures
 * decoded with the protocol's own schemas: its posture label, how to take
 * part, its open asks (a blocked one names what it waits on) and its recent
 * landings, each with its author and its credit trailers as the commit
 * carries them.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { AskListing } from "@repo/protocol/domain/ask";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { LandingView } from "@repo/protocol/domain/landing";
import { DateTime, Schema } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectView } from "../src/features/project/project-page.tsx";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (element: ReactElement) =>
  markupOf(element)
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** The markup of the row for `ask`: from its `<li>` to the next ask's row. */
const rowOf = (markup: string, ask: string) => {
  const start = markup.indexOf(`data-ask="${ask}"`);
  const next = markup.indexOf("data-ask=", start + 1);

  return start === -1
    ? ""
    : markup.slice(start, next === -1 ? undefined : next);
};

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const platformUrl = "https://platform-test.example.workers.dev";

const listing = Schema.decodeSync(ProjectListing)({
  landedAt: "2026-10-06T09:00:00.000Z",
  openAsks: 2,
  posture: "openWithSealedEvidence",
  project: "datekit",
});

const asks = Schema.decodeSync(Schema.Array(AskListing))([
  {
    ask: "fix-week-start",
    blockedBy: [],
    claimed: false,
    kind: "bug",
    territory: "core",
    want: "A week starts on the locale's first day, not always on Sunday.",
  },
  {
    ask: "drop-legacy-parse",
    blockedBy: ["split-core", "split-format"],
    claimed: false,
    kind: "migrate",
    territory: "parse",
    want: "Nothing calls the legacy parser any more.",
  },
]);

const landings = Schema.decodeSync(Schema.Array(LandingView))([
  {
    ask: "parse-iso-week",
    assisted: [{ harness: "claude-code", verified: true }],
    author: "bram",
    credits: [
      { handle: "bram", role: "Signed-off-by" },
      { handle: "ines-v", role: "Asked-by" },
    ],
    landedAt: "2026-10-06T09:00:00.000Z",
    parent: "1111111111111111111111111111111111111111",
    project: "datekit",
    sha: "9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c",
  },
  {
    ask: "format-era",
    assisted: [],
    author: "okonkwo",
    credits: [
      { handle: "okonkwo", role: "Signed-off-by" },
      { handle: "lin-h", role: "Asked-by" },
    ],
    landedAt: "2026-10-04T09:00:00.000Z",
    parent: "2222222222222222222222222222222222222222",
    project: "datekit",
    sha: "1111111111111111111111111111111111111111",
  },
]);

const page = (
  <ProjectView
    asks={asks}
    landings={landings}
    listing={listing}
    now={now}
    platformUrl={platformUrl}
  />
);

describe(ProjectView, () => {
  it("shows each landing's subject line and links its author to their page", () => {
    const text = textOf(page);
    const markup = markupOf(page);

    expect(text).toContain("Answer parse-iso-week");
    expect(text).toContain("Answer format-era");
    expect(markup).toMatch(/<a\b[^>]*href="\/people\/bram"[^>]*>bram<\/a>/u);
    expect(markup).toMatch(
      /<a\b[^>]*href="\/people\/okonkwo"[^>]*>okonkwo<\/a>/u
    );
  });

  it("shows each landing's credit trailers as the commit carries them, Assisted-by apart", () => {
    const text = textOf(page);

    const at = [
      "Asked-by: ines-v",
      "Signed-off-by: bram",
      "not credit",
      "Assisted-by: claude-code (verified)",
      "Asked-by: lin-h",
      "Signed-off-by: okonkwo",
    ].map((part) => text.indexOf(part));

    // Each landing's credit in trailer order, then its agents, apart.
    expect(at.every((position) => position >= 0)).toBeTruthy();
    expect(at.toSorted((one, other) => one - other)).toStrictEqual(at);
  });

  it("shows a blocked ask as blocked, linking every ask it waits on", () => {
    const markup = markupOf(page);
    const row = rowOf(markup, "drop-legacy-parse");

    expect(row).toMatch(/Blocked/u);
    expect(row).toContain('href="/datekit/asks/split-core"');
    expect(row).toContain('href="/datekit/asks/split-format"');
  });

  it("lists every open ask with its want, kind and territory", () => {
    const text = textOf(page);

    expect(text).toContain("fix-week-start");
    expect(text).toContain(
      "A week starts on the locale's first day, not always on Sunday."
    );
    expect(text).toContain("bug");
    expect(text).toContain("core");
  });

  it("shows the posture label of the project as it is listed", () => {
    const markup = markupOf(page);

    expect(markup).toContain('data-posture="openWithSealedEvidence"');
    expect(textOf(page)).toContain("Open with sealed evidence");
  });

  it("shows how to take part: clone over plain git, then the CLI's asks, claim and check", () => {
    const text = textOf(page);

    expect(text).toContain(`git clone ${platformUrl}/datekit.git`);
    expect(text).toContain(`${Brand.cli} asks --project datekit`);
    expect(text).toContain(`${Brand.cli} claim <ask>`);
    expect(text).toContain(`${Brand.cli} check`);
  });

  it("says an empty project is empty, with the commands that would fill it", () => {
    const text = textOf(
      <ProjectView
        asks={[]}
        landings={[]}
        listing={{ ...listing, openAsks: 0 }}
        now={now}
        platformUrl={platformUrl}
      />
    );

    expect(text).toContain("No open asks");
    expect(text).toContain(`${Brand.cli} ask open`);
    expect(text).toContain("Nothing has landed");
    expect(text).toContain(`${Brand.cli} init`);
  });
});

describe("the project, front page and people views", () => {
  // Views only: props in, markup out. A view that fetched would tie its page
  // to one transport (src/surfaces.ts); the atoms live in src/client/.
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/{front,project,people}/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  const transport =
    /from\s+["'](?:@repo\/protocol\/contracts|effect\/(?:rpc|http|reactivity)|#backend|[./]+\/(?:surfaces|client\/[^"']*|server\/[^"']*)(?:\.tsx?)?)["']/u;

  it("import no transport", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);

    const reaching = Object.entries(sources).flatMap(([path, source]) =>
      transport.test(source) ? [path] : []
    );

    expect(reaching).toStrictEqual([]);
  });
});
