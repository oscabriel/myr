/**
 * The "why" page, rendered to HTML with `react-dom/server` from a
 * `WhyView` decoded with the protocol's own schema: the server's fallback
 * is a table of ranges (lines a–b → the landing or the commit that brought
 * them) beside the numbered lines, each landing linking its ask, its
 * answer, its commit and its people; the browser's drawing is Pierre's
 * (`<diffs-container>`), loaded only there.
 */
import { describe, expect, it } from "@effect/vitest";
import { WhyView } from "@repo/protocol/domain/code";
import { Outcome } from "@repo/protocol/domain/outcome";
import { LandedSha, ProjectName } from "@repo/protocol/ids";
import { Schema } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WhyCode } from "../src/features/why/why-code.tsx";
import { WhyLines } from "../src/features/why/why-view.tsx";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/gu, " ");

/** Every `href` in `markup`, in order, entities decoded. */
const hrefsOf = (markup: string) =>
  [...markup.matchAll(/href="(?<href>[^"]*)"/gu)].map((match) =>
    (match.groups?.href ?? "").replaceAll("&amp;", "&")
  );

/** The markup of the table row marked `data-range` with `value`. */
const rowOf = (markup: string, value: string) =>
  new RegExp(`<tr\\b[^>]*data-range="${value}"[^>]*>[\\s\\S]*?</tr>`, "u").exec(
    markup
  )?.[0] ?? "";

const datekit = ProjectName.make("datekit");

const AT = "a".repeat(40);

const LANDED = "1".repeat(40);

const IMPORTED = "2".repeat(40);

const ROOT = "3".repeat(40);

const signature = (name: string, at: string) => ({
  at,
  email: `${name.toLowerCase()}@example.com`,
  name,
});

const view = Schema.decodeSync(WhyView)({
  at: AT,
  commits: [
    {
      author: signature("Bram", "2026-10-06T15:00:00.000Z"),
      body: "",
      committer: signature("platform", "2026-10-06T15:00:00.000Z"),
      parents: [IMPORTED],
      sha: LANDED,
      subject: "Answer parse-iso-week",
      trailers: [],
      tree: "4".repeat(40),
    },
    {
      author: signature("Ada", "2026-09-01T09:00:00.000Z"),
      body: "",
      committer: signature("Ada", "2026-09-01T09:00:00.000Z"),
      parents: [ROOT],
      sha: IMPORTED,
      subject: "Add the formatter",
      trailers: [],
      tree: "5".repeat(40),
    },
  ],
  landings: [
    {
      ask: "parse-iso-week",
      assisted: [{ harness: "pi", model: "opus-4", verified: true }],
      author: "bram",
      credits: [
        { handle: "bram", role: "Signed-off-by" },
        { handle: "ines-v", role: "Asked-by" },
      ],
      landedAt: "2026-10-06T15:00:00.000Z",
      parent: IMPORTED,
      project: "datekit",
      sha: LANDED,
      verdict: {
        ask: "parse-iso-week",
        at: "2026-10-06T14:59:00.000Z",
        base: IMPORTED,
        checkVersion: "redThenGreen@0.0.0+abc",
        head: "7".repeat(40),
        heldBack: [],
        lanes: [],
        outcome: Schema.encodeSync(Outcome)(
          Outcome.cases.Landed.make({ sha: LandedSha.make(LANDED) })
        ),
        patchId: "8".repeat(64),
        project: "datekit",
        stage: "checks",
        tree: "4".repeat(40),
        verifier: "platform",
      },
    },
  ],
  path: "src/format.ts",
  ranges: [
    { end: 3, sha: LANDED, start: 1 },
    { end: 4, sha: IMPORTED, start: 4 },
  ],
});

const TEXT =
  "export const iso = 1;\nexport const week = 2;\nexport const day = 3;\nexport const old = 4;\n";

const page = <WhyLines project={datekit} rev="main" text={TEXT} view={view} />;

describe("the why page's fallback", () => {
  it("names the landing that brought lines 1–3, linking its ask, its answer, its commit and its people", () => {
    const row = rowOf(markupOf(page), "1-3");

    expect(textOf(row)).toContain("lines 1–3");
    expect(textOf(row)).toContain("Answer parse-iso-week");
    expect(textOf(row)).toContain("2 credits");
    expect(textOf(row)).toContain("checked and landed");
    expect(hrefsOf(row)).toStrictEqual(
      expect.arrayContaining([
        "/datekit/asks/parse-iso-week",
        "/datekit/answers/parse-iso-week",
        `/datekit/commit/${LANDED}`,
        "/people/bram",
      ])
    );
  });

  it("says an imported commit's lines came before adoption", () => {
    const row = rowOf(markupOf(page), "4-4");

    expect(textOf(row)).toContain("line 4");
    expect(textOf(row)).toContain("Add the formatter");
    expect(textOf(row)).toContain("Ada");
    expect(textOf(row)).toContain("before adoption");
    expect(hrefsOf(row)).toContain(`/datekit/commit/${IMPORTED}`);
  });

  it("links the file as it was before each commit, and a proposal about each range's first line", () => {
    const markup = markupOf(page);
    const hrefs = hrefsOf(markup);

    expect(hrefs).toContain(`/datekit/why/${IMPORTED}/src/format.ts`);
    expect(textOf(markup)).toContain("Prior to this landing");
    expect(textOf(markup)).toContain("Propose an ask about this line");

    const proposal = hrefs
      .filter((href) => href.startsWith("/datekit/proposals/new?"))
      .map((href) =>
        Object.fromEntries(new URL(href, "https://x").searchParams)
      );

    expect(proposal).toStrictEqual([
      { about: "src/format.ts", at: AT, line: "1" },
      { about: "src/format.ts", at: AT, line: "4" },
    ]);
  });

  it("numbers every line beside the table, and leaves the drawing to the browser", () => {
    const markup = markupOf(page);

    expect(markup).toContain('id="L4"');
    expect(markup).not.toContain("<diffs-container");
  });

  it("says why a file without ranges has none", () => {
    const binary = Schema.decodeSync(WhyView)({
      at: AT,
      commits: [],
      landings: [],
      path: "logo.png",
      ranges: [],
    });

    expect(
      textOf(markupOf(<WhyLines project={datekit} rev="main" view={binary} />))
    ).toContain("binary or too large");
  });
});

describe("the why page's drawing", () => {
  it("draws the file with @pierre/diffs", () => {
    expect(
      markupOf(<WhyCode project={datekit} text={TEXT} view={view} />)
    ).toContain("<diffs-container");
  });
});
