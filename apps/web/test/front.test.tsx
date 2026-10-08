/**
 * The front page, rendered to HTML with `react-dom/server` from fixtures
 * decoded with the protocol's own schemas: open asks across projects, the
 * ones a viewer may take first, each other one with the reason it is not
 * theirs to take, narrowed by kind and by who an ask is held for.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import { KindName } from "@repo/protocol/ids";
import { DateTime, Schema } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FrontPageView,
  filterEntries,
  readFilter,
} from "../src/features/front/front-page.tsx";
import type { FrontFilter } from "../src/features/front/front-page.tsx";

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

const kind = Schema.decodeSync(KindName);

/** The markup of the row for `ask`: from its `<li>` to the next ask's row. */
const rowOf = (markup: string, ask: string) => {
  const start = markup.indexOf(`data-ask="${ask}"`);
  const next = markup.indexOf("data-ask=", start + 1);

  return start === -1
    ? ""
    : markup.slice(start, next === -1 ? undefined : next);
};

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const entries = Schema.decodeSync(Schema.Array(FrontPageEntry))([
  {
    ask: {
      ask: "explain-iso-week",
      blockedBy: [],
      claimed: false,
      kind: "bug",
      reserve: "newcomers",
      territory: "core",
      want: "The docs say which week of the year a date falls in.",
    },
    posture: "open",
    project: "datekit",
    takeable: false,
  },
  {
    ask: {
      ask: "fix-week-start",
      blockedBy: [],
      claimed: false,
      kind: "bug",
      territory: "core",
      want: "A week starts on the locale's first day, not always on Sunday.",
    },
    posture: "open",
    project: "datekit",
    takeable: true,
  },
  {
    ask: {
      ask: "split-format",
      blockedBy: [],
      claimed: false,
      kind: "migrate",
      territory: "format",
      want: "The format package calls the new parser.",
    },
    posture: "openWithSealedEvidence",
    project: "burrow",
    takeable: true,
  },
]);

const projects = Schema.decodeSync(Schema.Array(ProjectListing))([
  {
    landedAt: "2026-10-06T09:00:00.000Z",
    openAsks: 1,
    posture: "openWithSealedEvidence",
    project: "burrow",
  },
  { openAsks: 2, posture: "open", project: "datekit" },
]);

const asksOf = (shown: readonly FrontPageEntry[]) =>
  shown.map(({ ask }) => ask.ask);

/** The ask ids of the rows on the page, top to bottom. */
const rowsOf = (element: ReactElement) =>
  [...markupOf(element).matchAll(/<li\b[^>]*data-ask="(?<ask>[^"]+)"/gu)].map(
    (row) => row.groups?.ask
  );

const front = (filter: FrontFilter) => (
  <FrontPageView
    entries={entries}
    filter={filter}
    now={now}
    projects={projects}
  />
);

describe(filterEntries, () => {
  it("puts the asks the viewer may take first, keeping the order given", () => {
    expect(asksOf(filterEntries(entries, {}))).toStrictEqual([
      "fix-week-start",
      "split-format",
      "explain-iso-week",
    ]);
  });

  it("narrows the list to one kind", () => {
    expect(
      asksOf(filterEntries(entries, { kind: kind("migrate") }))
    ).toStrictEqual(["split-format"]);
  });

  it("narrows the list to the asks held for newcomers", () => {
    expect(
      asksOf(filterEntries(entries, { reserved: "newcomers" }))
    ).toStrictEqual(["explain-iso-week"]);
  });
});

describe(readFilter, () => {
  it("keeps a valid kind and reserve from the address, and drops what is not one", () => {
    expect(readFilter({ kind: "bug", reserved: "newcomers" })).toStrictEqual({
      kind: "bug",
      reserved: "newcomers",
    });
    expect(
      readFilter({ kind: "Not A Kind", reserved: "everyone" })
    ).toStrictEqual({});
  });
});

describe(FrontPageView, () => {
  it("shows the asks the viewer may take first", () => {
    expect(rowsOf(front({}))).toStrictEqual([
      "fix-week-start",
      "split-format",
      "explain-iso-week",
    ]);
  });

  it("marks an ask the viewer may not take with the reason", () => {
    const markup = markupOf(front({}));
    const row = rowOf(markup, "explain-iso-week");

    expect(row).toContain('data-takeable="false"');
    expect(row).toContain("Held for newcomers");
    expect(markup).toContain('data-takeable="true"');
  });

  it("shows each ask's project, want, kind and territory, and links its project", () => {
    const text = textOf(front({}));
    const markup = markupOf(front({}));

    expect(text).toContain(
      "A week starts on the locale's first day, not always on Sunday."
    );
    expect(text).toContain("migrate");
    expect(text).toContain("format");
    expect(markup).toContain('href="/burrow"');
    expect(markup).toContain('href="/datekit/asks/fix-week-start"');
  });

  it("gives an ask the viewer may take the command that claims it", () => {
    expect(textOf(front({}))).toContain(
      `${Brand.cli} claim fix-week-start --project datekit`
    );
  });

  it("narrows the list by kind, and offers every kind on the page as a filter", () => {
    const markup = markupOf(front({ kind: kind("migrate") }));

    expect(rowsOf(front({ kind: kind("migrate") }))).toStrictEqual([
      "split-format",
    ]);
    expect(markup).toContain('href="/?kind=bug"');
    expect(markup).toContain('href="/?kind=migrate"');
    expect(markup).toContain('href="/?kind=migrate&amp;reserved=newcomers"');
    expect(markupOf(front({}))).toContain('href="/?reserved=newcomers"');
  });

  it("lists every project with its posture label", () => {
    const text = textOf(front({}));

    expect(text).toContain("Open with sealed evidence");
    expect(markupOf(front({}))).toContain('href="/datekit"');
  });

  it("says an empty front page is empty, with the command that starts a project", () => {
    const text = textOf(
      <FrontPageView entries={[]} filter={{}} now={now} projects={[]} />
    );

    expect(text).toContain("No open asks");
    expect(text).toContain(`${Brand.cli} init`);
  });

  it("says a front page with projects but no asks needs an ask opened", () => {
    const text = textOf(
      <FrontPageView entries={[]} filter={{}} now={now} projects={projects} />
    );

    expect(text).toContain("No open asks");
    expect(text).toContain(`${Brand.cli} ask open`);
  });
});
