/**
 * The code browser's pages, rendered to HTML with `react-dom/server` from
 * fixtures decoded with the protocol's own schemas: a folder (`TreeView`), a
 * file (`BlobView`), the landings (`LogView`), one commit (`CommitView`), a
 * missing path's soft landing; the refs page has its own test
 * (`refs.test.tsx`). Each is what the server sends before the browser
 * loads Pierre: the tree and the
 * highlighted code are client-only, so none of these pages carries a
 * `<file-tree-container` or a `<diffs-container`; a commit's diff arrives as
 * plain text at the drawing's measures.
 */
import { describe, expect, it } from "@effect/vitest";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { Contract } from "@repo/protocol/contracts";
import {
  CommitDiff,
  CommitView as Commit,
  FileView,
  RefsView as Refs,
  TreeListing,
} from "@repo/protocol/domain/code";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  CommitSha,
  LandedSha,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import {
  UnknownCommit,
  UnknownPath,
  UnknownProject,
  UnknownRevision,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import { RpcTest } from "effect/rpc";
import type { Rpc } from "effect/rpc";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BlobView } from "../src/features/code/blob-view.tsx";
import { CommitView } from "../src/features/code/commit-view.tsx";
import { LOG_PAGE } from "../src/features/code/log-page.ts";
import { LogView } from "../src/features/code/log-view.tsx";
import { CodeNotFound } from "../src/features/code/not-found.tsx";
import { SoftLanding } from "../src/features/code/soft-landing.ts";
import { TreeView } from "../src/features/code/tree-view.tsx";
import { Refusals } from "../src/features/shared/refusals.ts";
import {
  readBlobPage,
  Route as BlobRoute,
} from "../src/routes/$project/blob/$rev/$.tsx";
import { readCommitPage } from "../src/routes/$project/commit/$sha.tsx";
import { readLogPage } from "../src/routes/$project/commits/$rev.tsx";
import { readRefsPage } from "../src/routes/$project/refs.tsx";
import {
  readTreePage,
  Route as TreeRoute,
} from "../src/routes/$project/tree/$rev/$.tsx";
import { codePageHeaders } from "../src/routes/$project/tree/-headers.ts";
import { Route as WhyRoute } from "../src/routes/$project/why/$rev/$.tsx";
import { branchPage, immutablePage } from "../src/server/cache-headers.ts";
import { reachingTransport } from "./transport.ts";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (element: ReactElement) =>
  markupOf(element)
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/gu, " ");

/** Every `href` in `markup`, in order, entities decoded. */
const hrefsOf = (markup: string) =>
  [...markup.matchAll(/href="(?<href>[^"]*)"/gu)].map((match) =>
    (match.groups?.href ?? "").replaceAll("&amp;", "&")
  );

/** The markup from the element marked `marker` to the next element marked the same way. */
const slice = (markup: string, marker: string, value: string) => {
  const start = markup.indexOf(`${marker}="${value}"`);
  const next = markup.indexOf(`${marker}="`, start + 1);

  return start === -1
    ? ""
    : markup.slice(start, next === -1 ? undefined : next);
};

/** The `<nav>` marked `attribute` (`data-slot="breadcrumb"`), whole. */
const navOf = (markup: string, attribute: string) =>
  new RegExp(`<nav\\b[^>]*${attribute}[^>]*>[\\s\\S]*?</nav>`, "u").exec(
    markup
  )?.[0] ?? "";

const datekit = ProjectName.make("datekit");

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const AT = "a".repeat(40);

const decodeTree = Schema.decodeSync(TreeListing);

const decodeFile = Schema.decodeSync(FileView);

const root = decodeTree({
  at: AT,
  entries: [
    {
      mode: "040000",
      name: "src",
      path: "src",
      sha: "b".repeat(40),
      type: "tree",
    },
    {
      mode: "100644",
      name: "README.md",
      path: "README.md",
      sha: "c".repeat(40),
      type: "blob",
    },
  ],
  readme: { path: "README.md", sha: "c".repeat(40) },
});

const readme = decodeFile({
  at: AT,
  binary: false,
  path: "README.md",
  sha: "c".repeat(40),
  size: 26,
  text: "# datekit\n\nDates, kept.\n",
  truncated: false,
});

const nested = decodeTree({
  at: AT,
  entries: [
    {
      mode: "100644",
      name: "en.ts",
      path: "src/format/locale/en.ts",
      sha: "d".repeat(40),
      type: "blob",
    },
  ],
  path: "src/format/locale",
});

/** A tag with a slash and an at sign: one URL-encoded segment. */
const TAG = "@datekit/core@1.0.0";

const TAG_SEGMENT = "%40datekit%2Fcore%401.0.0";

const decodeCommits = Schema.decodeSync(Schema.Array(Commit));

const signature = (name: string, at: string) => ({
  at,
  email: `${name}@example.com`,
  name,
});

const LANDED = "1".repeat(40);

const IMPORTED = "2".repeat(40);

const OLDER = "3".repeat(40);

const commits = decodeCommits([
  {
    author: signature("Bram", "2026-10-06T15:00:00.000Z"),
    body: "",
    committer: signature("platform", "2026-10-06T15:00:00.000Z"),
    landing: {
      ask: "parse-iso-week",
      assisted: [],
      author: "bram",
      credits: [
        { handle: "bram", role: "Signed-off-by" },
        { handle: "ines-v", role: "Asked-by" },
      ],
      landedAt: "2026-10-06T15:00:00.000Z",
      parent: IMPORTED,
      project: "datekit",
      sha: LANDED,
    },
    parents: [IMPORTED],
    sha: LANDED,
    subject: "Answer parse-iso-week",
    trailers: [
      { key: "Asked-by", value: "ines-v" },
      { key: "Signed-off-by", value: "bram" },
    ],
    tree: "4".repeat(40),
  },
  {
    author: signature("Lin", "2026-10-06T09:00:00.000Z"),
    body: "",
    committer: signature("Lin", "2026-10-06T09:00:00.000Z"),
    parents: [OLDER],
    sha: IMPORTED,
    subject: "Support week numbers",
    trailers: [],
    tree: "5".repeat(40),
  },
  {
    author: signature("Lin", "2026-10-04T09:00:00.000Z"),
    body: "",
    committer: signature("Lin", "2026-10-04T09:00:00.000Z"),
    parents: [],
    sha: OLDER,
    subject: "First commit",
    trailers: [],
    tree: "6".repeat(40),
  },
]);

const decodeDiff = Schema.decodeSync(CommitDiff);

const landedCommit: typeof Commit.Encoded = {
  author: signature("Bram", "2026-10-06T15:00:00.000Z"),
  body: "Parse ISO week dates.\n\nAsked-by: ines-v\nSigned-off-by: bram",
  committer: signature("platform", "2026-10-06T15:00:00.000Z"),
  landing: {
    ask: "parse-iso-week",
    assisted: [],
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
      lanes: [
        {
          command: "bun test",
          durationMs: 1200,
          lane: "unit",
          result: "passed",
        },
      ],
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
  parents: [IMPORTED],
  sha: LANDED,
  subject: "Answer parse-iso-week",
  trailers: [
    { key: "Asked-by", value: "ines-v <ines-v@users.example.com>" },
    { key: "Signed-off-by", value: "bram <bram@users.example.com>" },
  ],
  tree: "4".repeat(40),
};

const diff = decodeDiff({
  commit: landedCommit,
  files: [
    {
      after: "9".repeat(40),
      binary: false,
      newText: "export const week = 1;\n",
      path: "src/week.ts",
      status: "added",
    },
    {
      after: "a".repeat(40),
      before: "b".repeat(40),
      binary: false,
      newText: "export const parse = fromIso;\n",
      oldText: "export const parse = Date;\n",
      path: "src/parse.ts",
      status: "modified",
    },
    {
      before: "c".repeat(40),
      binary: false,
      oldText: "export const legacy = true;\n",
      path: "src/legacy.ts",
      status: "deleted",
    },
  ],
  truncated: false,
});

/** The markup of `<main>` alone: the page, without its inspector. */
const mainOf = (markup: string) =>
  /<main\b[\s\S]*?<\/main>/u.exec(markup)?.[0] ?? "";

/** The markup of the inspector alone. */
const inspectorOf = (markup: string) =>
  /<aside\b[^>]*data-facts="inspector"[\s\S]*?<\/aside>/u.exec(markup)?.[0] ??
  "";

/** How many times `part` appears in `text`. */
const countIn = (text: string, part: string) => text.split(part).length - 1;

describe(TreeView, () => {
  const page = (
    <TreeView
      listing={root}
      now={now}
      project={datekit}
      readme={readme}
      rev="main"
    />
  );

  it("lists folders before files, each linking its own page at the same revision", () => {
    const markup = markupOf(page);

    expect(markup.indexOf('data-entry="src"')).toBeGreaterThan(-1);
    expect(markup.indexOf('data-entry="src"')).toBeLessThan(
      markup.indexOf('data-entry="README.md"')
    );
    expect(hrefsOf(markup)).toContain("/datekit/tree/main/src");
    expect(hrefsOf(markup)).toContain("/datekit/blob/main/README.md");
  });

  it("lists the folder once", () => {
    const markup = markupOf(page);

    expect(countIn(markup, 'data-entry="src"')).toBe(1);
    expect(countIn(markup, 'data-entry="README.md"')).toBe(1);
    expect(countIn(markup, "data-entries=")).toBe(1);
  });

  it("says what last changed each entry, once it has been read", () => {
    const [last] = commits;

    const markup = markupOf(
      <TreeView
        last={new Map(last === undefined ? [] : [["src", last]])}
        listing={root}
        now={now}
        project={datekit}
        rev="main"
      />
    );

    expect(slice(markup, "data-entry", "src")).toContain("parse-iso-week");
    expect(slice(markup, "data-entry", "src")).toContain("ago");
    expect(slice(markup, "data-entry", "README.md")).not.toContain("ago");
  });

  it("links each ancestor in its path at the same revision, and names the folder last", () => {
    const markup = markupOf(
      <TreeView listing={nested} now={now} project={datekit} rev={TAG} />
    );

    const crumbs = hrefsOf(navOf(markup, 'aria-label="Path"'));

    expect(crumbs).toStrictEqual([
      `/datekit/tree/${TAG_SEGMENT}`,
      `/datekit/tree/${TAG_SEGMENT}/src`,
      `/datekit/tree/${TAG_SEGMENT}/src/format`,
    ]);
    expect(
      textOf(
        <TreeView listing={nested} now={now} project={datekit} rev={TAG} />
      )
    ).toContain("locale");
  });

  it("renders the folder's README below its entries", () => {
    const markup = markupOf(page);

    expect(markup).toContain('data-readme="README.md"');
    expect(textOf(page)).toContain("Dates, kept.");
    expect(markup.indexOf("data-readme=")).toBeGreaterThan(
      markup.indexOf('data-entry="README.md"')
    );
  });

  it("leaves the file tree to the browser", () => {
    expect(markupOf(page)).not.toContain("<file-tree-container");
  });
});

describe(BlobView, () => {
  const parse = decodeFile({
    at: AT,
    binary: false,
    path: "src/format/parse.ts",
    sha: "e".repeat(40),
    size: 14,
    text: "one\ntwo\nthree\n",
    truncated: false,
  });

  const [lastLanding] = commits;

  const page = (
    <BlobView
      file={parse}
      last={lastLanding}
      now={now}
      project={datekit}
      rev="main"
    />
  );

  it("numbers each line of a text file with its own anchor, and draws no highlighting on the server", () => {
    const markup = markupOf(page);

    const anchors = [...markup.matchAll(/id="(?<line>L\d+)"/gu)].map(
      (match) => match.groups?.line
    );

    expect(markup).toContain("<pre");
    expect(anchors).toStrictEqual(["L1", "L2", "L3"]);
    expect(markup).not.toContain("<diffs-container");
  });

  it("anchors each line on an element that draws a box, so `#L2` scrolls to it without script", () => {
    // A `display: contents` element draws no box, and a browser cannot
    // scroll to it.
    const anchored = /<(?<tag>\w+)\b(?<attributes>[^>]*)\bid="L2"[^>]*>/u.exec(
      markupOf(page)
    );

    expect(anchored?.groups?.tag).toBe("span");
    expect(anchored?.groups?.attributes).not.toMatch(/\bcontents\b/u);
  });

  it("sets the plain text at the drawing's measures: 20 px lines and Pierre's gutter", () => {
    const code = /<pre\b[^>]*>/u.exec(markupOf(page))?.[0] ?? "";

    expect(code).toContain("leading-code");
    expect(code).toContain("text-mono");
    expect(markupOf(page)).toContain("min-w-[calc(6ch+2px)]");
    expect(markupOf(page)).toContain("pl-[2ch]");
  });

  it("names the path once in the page, in its file header", () => {
    const main = mainOf(markupOf(page));

    // The trail's segments, read as text, spell the path: once.
    expect(
      countIn(main.replaceAll(/<[^>]+>/gu, ""), "src/format/parse.ts")
    ).toBe(1);
    expect(countIn(main, 'title="src/format/parse.ts"')).toBe(1);
    expect(countIn(main, 'aria-label="Path"')).toBe(1);
    expect(hrefsOf(navOf(main, 'aria-label="Path"'))).toStrictEqual([
      "/datekit/tree/main",
      "/datekit/tree/main/src",
      "/datekit/tree/main/src/format",
    ]);
  });

  it("has the Code | Why toggle, Code current", () => {
    const toggle = navOf(markupOf(page), 'aria-label="Mode"');

    expect(hrefsOf(toggle)).toStrictEqual([
      "/datekit/blob/main/src/format/parse.ts",
      "/datekit/why/main/src/format/parse.ts",
    ]);
    expect(toggle).toMatch(/aria-current="page"[^>]*>Code</u);
    expect(toggle).not.toMatch(/aria-current="page"[^>]*>Why</u);
  });

  it("links raw at the commit and the permalink at the commit, and the history at the revision", () => {
    const markup = markupOf(page);
    const toolbar = navOf(markup, 'data-toolbar="file"');

    expect(hrefsOf(toolbar)).toStrictEqual([
      `/datekit/raw/${AT}/src/format/parse.ts`,
      `/datekit/blob/${AT}/src/format/parse.ts`,
    ]);
    expect(hrefsOf(inspectorOf(markup))).toContain(
      "/datekit/commits/main?path=src%2Fformat%2Fparse.ts"
    );
  });

  it("names the last landing's ask in This file, before its SHA", () => {
    const facts = inspectorOf(markupOf(page));
    const text = facts.replaceAll(/<[^>]+>/gu, "");

    expect(facts).toContain("This file");
    expect(text.indexOf("parse-iso-week")).toBeGreaterThan(-1);
    expect(text.indexOf("parse-iso-week")).toBeLessThan(
      text.indexOf(LANDED.slice(0, 7))
    );
    expect(text).toContain("answered by bram");
    expect(hrefsOf(facts)).toStrictEqual(
      expect.arrayContaining([
        "/datekit/asks/parse-iso-week",
        "/datekit/answers/parse-iso-week",
        `/datekit/commit/${LANDED}`,
      ])
    );
  });

  it("shows a binary file's size and a raw link, and no text", () => {
    const binary = decodeFile({
      at: AT,
      binary: true,
      path: "assets/fixture.bin",
      sha: "f".repeat(40),
      size: 2048,
      truncated: false,
    });

    const element = (
      <BlobView file={binary} now={now} project={datekit} rev="main" />
    );

    expect(markupOf(element)).not.toContain("<pre");
    expect(textOf(element)).toContain("2.0 KiB");
    expect(hrefsOf(markupOf(element))).toContain(
      `/datekit/raw/${AT}/assets/fixture.bin`
    );
  });

  it("says a file past the cap is too large to show, with a raw link", () => {
    const large = decodeFile({
      at: AT,
      binary: false,
      path: "data/zones.json",
      sha: "f".repeat(40),
      size: 3_145_728,
      truncated: true,
    });

    const element = (
      <BlobView file={large} now={now} project={datekit} rev="main" />
    );

    expect(markupOf(element)).not.toContain("<pre");
    expect(textOf(element)).toContain("too large to show");
    expect(textOf(element)).toContain("3.0 MiB");
    expect(hrefsOf(markupOf(element))).toContain(
      `/datekit/raw/${AT}/data/zones.json`
    );
  });

  it("shows an image inline from raw", () => {
    const logo = decodeFile({
      at: AT,
      binary: true,
      path: "docs/logo.png",
      sha: "f".repeat(40),
      size: 512,
      truncated: false,
    });

    expect(
      markupOf(<BlobView file={logo} now={now} project={datekit} rev="main" />)
    ).toMatch(
      new RegExp(`<img\\b[^>]*src="/datekit/raw/${AT}/docs/logo.png"`, "u")
    );
  });

  it("renders a Markdown file, and its source on ?plain=1", () => {
    const guide = decodeFile({
      at: AT,
      binary: false,
      path: "docs/guide.md",
      sha: "f".repeat(40),
      size: 18,
      text: "# Guide\n\nRead me.\n",
      truncated: false,
    });

    const rendered = markupOf(
      <BlobView file={guide} now={now} project={datekit} rev="main" />
    );

    const plain = markupOf(
      <BlobView file={guide} now={now} plain project={datekit} rev="main" />
    );

    expect(rendered).toContain('data-readme="docs/guide.md"');
    expect(rendered).not.toContain('id="L1"');
    expect(hrefsOf(rendered)).toContain(
      "/datekit/blob/main/docs/guide.md?plain=1"
    );
    expect(plain).toContain('id="L3"');
    expect(plain).not.toContain("data-readme=");
  });
});

describe(LogView, () => {
  const page = (
    <LogView
      commits={commits}
      from={0}
      next={30}
      now={now}
      project={datekit}
      rev="main"
    />
  );

  it("groups the commits of one day under one sticky header", () => {
    const markup = markupOf(page);

    const days = [...markup.matchAll(/data-day="(?<day>[^"]+)"/gu)].map(
      (match) => match.groups?.day
    );

    expect(days).toStrictEqual(["2026-10-06", "2026-10-04"]);

    const first = slice(markup, "data-day", "2026-10-06");

    expect(
      [LANDED, IMPORTED, OLDER].map((sha) =>
        first.includes(`data-commit="${sha}"`)
      )
    ).toStrictEqual([true, true, false]);
    expect(first).toMatch(/class="[^"]*\bsticky\b/u);
    expect(textOf(page)).toContain("October 6, 2026");
  });

  it("shows a landing's ask and credit in one line, and its short id over its age", () => {
    const row = slice(markupOf(page), "data-commit", LANDED);

    expect(hrefsOf(row)).toStrictEqual(
      expect.arrayContaining([
        "/datekit/asks/parse-iso-week",
        `/datekit/commit/${LANDED}`,
        "/people/ines-v",
      ])
    );
    expect(row).toContain("Asked by");
    expect(row.indexOf(LANDED.slice(0, 7))).toBeGreaterThan(-1);
    expect(row.indexOf(LANDED.slice(0, 7))).toBeLessThan(row.indexOf(" ago"));
  });

  it("marks a landing judged by sealed checks held back, with its lock", () => {
    const held = decodeCommits([
      {
        author: signature("Bram", "2026-10-06T15:00:00.000Z"),
        body: "",
        committer: signature("platform", "2026-10-06T15:00:00.000Z"),
        landing: {
          ask: "parse-iso-week",
          assisted: [],
          author: "bram",
          credits: [{ handle: "bram", role: "Signed-off-by" }],
          heldBackTrailer: "parser: 4 sealed checks by 3 people",
          landedAt: "2026-10-06T15:00:00.000Z",
          parent: IMPORTED,
          project: "datekit",
          sha: LANDED,
        },
        parents: [IMPORTED],
        sha: LANDED,
        subject: "Answer parse-iso-week",
        trailers: [],
        tree: "4".repeat(40),
      },
    ]);

    const row = slice(
      markupOf(
        <LogView
          commits={held}
          from={0}
          now={now}
          project={datekit}
          rev="main"
        />
      ),
      "data-commit",
      LANDED
    );

    expect(row).toContain("held back");
    expect(row).toContain("text-sealed");
    expect(row).toContain("lucide-lock-keyhole");
  });

  it("links the ask an opening's landing opened, and reads it as an opening", () => {
    const [opening] = decodeCommits([
      {
        author: signature("Okonkwo", "2026-10-06T15:00:00.000Z"),
        body: "",
        committer: signature("platform", "2026-10-06T15:00:00.000Z"),
        landing: {
          assisted: [],
          author: "okonkwo",
          credits: [{ handle: "okonkwo", role: "Decided-by" }],
          landedAt: "2026-10-06T15:00:00.000Z",
          opened: "parse-iso-week",
          parent: IMPORTED,
          project: "datekit",
          sha: LANDED,
        },
        parents: [IMPORTED],
        sha: LANDED,
        subject: "Open ask parse-iso-week",
        trailers: [{ key: "Decided-by", value: "okonkwo" }],
        tree: "4".repeat(40),
      },
    ]);

    const row = slice(
      markupOf(
        <LogView
          commits={opening === undefined ? [] : [opening]}
          from={0}
          now={now}
          project={datekit}
          rev="main"
        />
      ),
      "data-commit",
      LANDED
    );

    expect(hrefsOf(row)).toContain("/datekit/asks/parse-iso-week");
    expect(row).toContain("Opened");
  });

  it("filters the page to the answers or the asks' openings", () => {
    const answers = markupOf(
      <LogView
        commits={commits}
        from={0}
        now={now}
        project={datekit}
        rev="main"
        show="answers"
      />
    );

    expect(answers).toContain(`data-commit="${LANDED}"`);
    expect(answers).not.toContain(`data-commit="${IMPORTED}"`);

    const filters = navOf(markupOf(page), 'aria-label="Show"');

    expect(hrefsOf(filters)).toStrictEqual([
      "/datekit/commits/main",
      "/datekit/commits/main?show=answers",
      "/datekit/commits/main?show=openings",
    ]);
    expect(filters).toMatch(/aria-current="page"[^>]*>All</u);
  });

  it("says an imported commit came before adoption", () => {
    const row = slice(markupOf(page), "data-commit", IMPORTED);

    expect(row).toContain("before adoption");
    expect(hrefsOf(row)).toContain(`/datekit/commit/${IMPORTED}`);
    expect(slice(markupOf(page), "data-commit", LANDED)).not.toContain(
      "before adoption"
    );
  });

  it("links the older page from where this one ends, and no newer page from the first", () => {
    const pager = navOf(markupOf(page), 'data-slot="pagination"');

    expect(hrefsOf(pager)).toStrictEqual(["/datekit/commits/main?from=30"]);
  });

  it("keeps the path on both pages of a path's history", () => {
    const pager = navOf(
      markupOf(
        <LogView
          commits={commits}
          from={30}
          next={60}
          now={now}
          path={RepoPath.make("src/parse.ts")}
          project={datekit}
          rev="main"
        />
      ),
      'data-slot="pagination"'
    );

    expect(hrefsOf(pager)).toStrictEqual([
      "/datekit/commits/main?path=src%2Fparse.ts",
      "/datekit/commits/main?path=src%2Fparse.ts&from=60",
    ]);
  });

  it("keeps the filter on both pages: Older and Newer show the same kind", () => {
    const pager = navOf(
      markupOf(
        <LogView
          commits={commits}
          from={30}
          next={60}
          now={now}
          project={datekit}
          rev="main"
          show="answers"
        />
      ),
      'data-slot="pagination"'
    );

    expect(hrefsOf(pager)).toStrictEqual([
      "/datekit/commits/main?show=answers",
      "/datekit/commits/main?from=60&show=answers",
    ]);
  });

  it("goes back to a path's newest commits from a later page, since a path's `from` counts commits scanned, not shown", () => {
    // The platform scans 200 commits a call for a path, so the page that
    // starts at 230 may follow one that started at 30 or at 0: only the
    // first page is known to be newer.
    const pager = navOf(
      markupOf(
        <LogView
          commits={commits}
          from={230}
          next={430}
          now={now}
          path={RepoPath.make("src/parse.ts")}
          project={datekit}
          rev="main"
        />
      ),
      'data-slot="pagination"'
    );

    expect(hrefsOf(pager)).toStrictEqual([
      "/datekit/commits/main?path=src%2Fparse.ts",
      "/datekit/commits/main?path=src%2Fparse.ts&from=430",
    ]);
  });
});

/** Lines `1` to `count`, as a file's text. */
const linesUpTo = (count: number) =>
  `${Array.from({ length: count }, (_, index) => `line ${index + 1}`).join(
    "\n"
  )}\n`;

/** `diff`, with an added file of 120 lines: long enough to start folded. */
const long = decodeDiff({
  ...Schema.encodeSync(CommitDiff)(diff),
  files: [
    ...Schema.encodeSync(CommitDiff)(diff).files,
    {
      after: "d".repeat(40),
      binary: false,
      newText: linesUpTo(120),
      path: "data/zones.ts",
      status: "added",
    },
  ],
});

describe(CommitView, () => {
  const page = <CommitView diff={diff} now={now} project={datekit} />;

  it("names the people in its credit, each linking their page, and shows its trailers once", () => {
    const markup = markupOf(page);
    const hrefs = hrefsOf(markup);

    expect(hrefs).toStrictEqual(
      expect.arrayContaining(["/people/ines-v", "/people/bram"])
    );
    expect(
      ["Asked-by:", "Signed-off-by:", "data-body"].map((part) =>
        countIn(markup, part)
      )
    ).toStrictEqual([1, 1, 1]);
    expect(
      /<p\b[^>]*data-body=""[^>]*>[^<]*<\/p>/u.exec(markup)?.[0]
    ).not.toContain("Asked-by");
  });

  it("sets its body as prose in the sans, never in mono", () => {
    const body =
      /<p\b[^>]*data-body=""[^>]*>[^<]*<\/p>/u.exec(markupOf(page))?.[0] ?? "";

    expect(body).toContain("Parse ISO week dates.");
    expect(body).not.toContain("font-mono");
    expect(body).toContain("text-body");
  });

  it("links no one from an imported commit's trailers", () => {
    const { landing: _landing, ...imported } = landedCommit;

    const markup = markupOf(
      <CommitView
        diff={decodeDiff({ commit: imported, files: [], truncated: false })}
        now={now}
        project={datekit}
      />
    );

    expect(hrefsOf(markup)).not.toContain("/people/bram");
    expect(markup).toContain("bram@users.example.com");
    expect(markup).toContain("Before adoption");
  });

  it("leads with the landing's status line: landed as its id, and the ask it answered", () => {
    const markup = markupOf(page);
    const text = mainOf(markup).replaceAll(/<[^>]+>/gu, "");

    expect(text).toContain(`Landed as ${LANDED.slice(0, 7)}`);
    expect(text).toContain("answered parse-iso-week");
    expect(hrefsOf(markup)).toContain("/datekit/asks/parse-iso-week");
    expect(hrefsOf(markup)).toContain("/datekit/answers/parse-iso-week");
    expect(markup).toContain('data-outcome="Landed"');
  });

  it("links the ask an opening opened, and no answer, since it answers none", () => {
    const markup = markupOf(
      <CommitView
        diff={decodeDiff({
          commit: {
            ...landedCommit,
            landing: {
              assisted: [],
              author: "okonkwo",
              credits: [{ handle: "okonkwo", role: "Decided-by" }],
              landedAt: "2026-10-06T15:00:00.000Z",
              opened: "parse-iso-week",
              parent: IMPORTED,
              project: "datekit",
              sha: LANDED,
            },
            subject: "Open ask parse-iso-week",
          },
          files: [],
          truncated: false,
        })}
        now={now}
        project={datekit}
      />
    );

    expect(hrefsOf(markup)).toContain("/datekit/asks/parse-iso-week");
    expect(hrefsOf(markup)).not.toContain("/datekit/answers/parse-iso-week");
    expect(markup).toContain("opened");
  });

  it("puts git's own facts on one line: author, committer and parent, linked", () => {
    const text = textOf(page);

    expect(hrefsOf(markupOf(page))).toContain(`/datekit/commit/${IMPORTED}`);
    expect(text).toContain("authored by Bram");
    expect(text).toContain("committed by the platform");
    expect(text).toContain(`parent ${IMPORTED.slice(0, 7)}`);
  });

  it("sends each changed file's diff as plain text, at the drawing's measures", () => {
    const markup = markupOf(page);

    const plain =
      /<div\b[^>]*data-diff="plain"[\s\S]*$/u.exec(markup)?.[0] ?? "";

    expect(
      ["leading-code", "min-w-[calc(6ch+2px)]", "pl-[2ch]"].filter(
        (measure) => !plain.includes(measure)
      )
    ).toStrictEqual([]);
    expect(
      ["src/week.ts", "src/parse.ts", "src/legacy.ts"].filter(
        (path) =>
          !slice(plain, "data-file", path).includes('data-diffs-header=""')
      )
    ).toStrictEqual([]);
    expect(
      [
        ["src/parse.ts", "export const parse = fromIso;"],
        ["src/parse.ts", "export const parse = Date;"],
        ["src/week.ts", "export const week = 1;"],
      ].filter(
        ([path = "", line = ""]) =>
          !slice(plain, "data-file", path).includes(line)
      )
    ).toStrictEqual([]);
    expect(markup).not.toMatch(/<(?:diffs|file-tree)-container/u);
  });

  it("keeps each file's header at the top of the pane while its lines scroll", () => {
    const header =
      /<summary\b[^>]*data-diffs-header=""[^>]*>/u.exec(markupOf(page))?.[0] ??
      "";

    expect(header).toContain("sticky");
    expect(header).toContain("top-0");
    expect(header).toContain("h-11");
  });

  it("starts an added or deleted file past 80 lines folded", () => {
    const markup = markupOf(
      <CommitView diff={long} now={now} project={datekit} />
    );

    expect(slice(markup, "data-file", "data/zones.ts")).toContain(
      'data-folded="true"'
    );
    expect(slice(markup, "data-file", "data/zones.ts")).not.toMatch(
      /<details\b[^>]*\bopen=/u
    );
    expect(slice(markup, "data-file", "src/parse.ts")).toContain(
      'data-folded="false"'
    );
  });

  it("counts the diff in the inspector: files, additions and deletions, split by path", () => {
    const facts = inspectorOf(
      markupOf(
        <CommitView
          diff={long}
          now={now}
          project={datekit}
          territory={["src/**"]}
        />
      )
    );

    const stats =
      /<section\b[^>]*aria-label="Diff stats"[\s\S]*?<\/section>/u.exec(
        facts
      )?.[0] ?? "";

    const text = stats.replaceAll(/<[^>]+>/gu, " ").replaceAll(/\s+/gu, " ");

    expect(text).toContain("4 files");
    expect(text).toContain("+122 added");
    expect(text).toContain("−2 removed");
    expect(slice(stats, "data-part", "territory")).toContain("+2");
    expect(slice(stats, "data-part", "other")).toContain("+120");
  });

  it("says when the commit is too large to show whole", () => {
    const truncated = decodeDiff({
      commit: landedCommit,
      files: [{ binary: false, path: "data/zones.json", status: "modified" }],
      truncated: true,
    });

    expect(
      textOf(<CommitView diff={truncated} now={now} project={datekit} />)
    ).toContain("too large to show whole");
    expect(textOf(page)).not.toContain("too large to show whole");
  });
});

/** A payload the platform was sent: one of the contracts'. */
type Sent = Rpc.Payload<Contract>;

/** Datekit, or the refusal for any other project. */
const knownProject = (name: ProjectName) =>
  name === datekit
    ? Effect.void
    : Effect.fail(new UnknownProject({ project: name }));

/** Main, or its commit `AT`, or the refusal for any other revision. */
const knownRevision = (at: string | undefined) =>
  at === undefined || at === "main" || at === AT
    ? Effect.void
    : Effect.fail(new UnknownRevision({ rev: at }));

/** Datekit's refs with main landed and no tags or forks. */
const landedOnly = Schema.decodeSync(Refs)({
  forks: [],
  landed: LANDED,
  project: "datekit",
  tags: [],
});

/** The refusal for a path datekit lacks at `AT`. */
const noPath = (path: RepoPath) =>
  new UnknownPath({ commit: CommitSha.make(AT), path });

/**
 * A platform that holds datekit at main (commit `AT`): its root (with a
 * README), the folder `src/format/locale`, the README, a page of the log
 * and one commit. Every payload it is sent is kept, in order.
 */
const platformOf = (calls: Ref.Ref<readonly Sent[]>) => {
  const sent = (payload: Sent) => Ref.update(calls, (all) => [...all, payload]);

  return Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("readTree", (payload) =>
          Effect.gen(function* () {
            yield* sent(payload);
            yield* knownProject(payload.project);
            yield* knownRevision(payload.at);

            if (payload.path === undefined) {
              return root;
            }

            if (payload.path === nested.path) {
              return nested;
            }

            return yield* noPath(payload.path);
          })
        ),
        Contracts.toLayerHandler("readFile", (payload) =>
          Effect.gen(function* () {
            yield* sent(payload);
            yield* knownProject(payload.project);
            yield* knownRevision(payload.at);

            if (payload.path === readme.path) {
              return readme;
            }

            return yield* noPath(payload.path);
          })
        ),
        Contracts.toLayerHandler("log", (payload) =>
          Effect.gen(function* () {
            yield* sent(payload);
            yield* knownProject(payload.project);
            yield* knownRevision(payload.at);

            return { commits, next: (payload.from ?? 0) + LOG_PAGE };
          })
        ),
        Contracts.toLayerHandler("showCommit", (payload) =>
          Effect.gen(function* () {
            yield* sent(payload);
            yield* knownProject(payload.project);

            if (payload.sha !== LANDED) {
              return yield* new UnknownCommit({ sha: payload.sha });
            }

            return diff;
          })
        ),
        Contracts.toLayerHandler("listRefs", (payload) =>
          Effect.gen(function* () {
            yield* sent(payload);
            yield* knownProject(payload.project);

            return landedOnly;
          })
        )
      ),
      asTester,
    ])
  );
};

/** What a page's read that ended in a not-found asked and carried. */
interface Refused {
  /** Every payload it sent the platform. */
  readonly calls: readonly Sent[];
  /** The refusals its not-found carried, as `git` prints them; none when it carried none. */
  readonly refused: Option.Option<readonly string[]>;
}

/** Runs a page's read against `platformOf`, which must end in a not-found. */
const refusedBy = <A, E>(
  read: Effect.Effect<A, E, Client>
): Effect.Effect<Refused> =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<readonly Sent[]>([]);

    const failed = yield* Effect.flip(
      read.pipe(Effect.provide(platformOf(calls)))
    );

    expect(isNotFound(failed)).toBeTruthy();

    const data: unknown = isNotFound(failed) ? failed.data : undefined;

    // A missing path lands on its nearest folder, its refusal beside it.
    const carried = Option.orElse(
      Schema.decodeUnknownOption(Refusals)(data),
      () =>
        Option.map(
          Schema.decodeUnknownOption(SoftLanding)(data),
          ({ refusals }) => refusals
        )
    );

    return {
      calls: yield* Ref.get(calls),
      refused: Option.map(carried, explain),
    };
  }).pipe(Effect.orDie);

describe("the code pages' reads", () => {
  it.effect("read a folder and its README for the folder's page", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<readonly Sent[]>([]);

      const read = yield* readTreePage({
        project: "datekit",
        rev: "main",
      }).pipe(Effect.provide(platformOf(calls)));

      expect(read.listing.entries.map((entry) => entry.path)).toStrictEqual([
        "src",
        "README.md",
      ]);
      expect(read.readme?.text).toBe(readme.text);
      expect(yield* Ref.get(calls)).toHaveLength(2);
    })
  );

  it.effect(
    "pass a tag's name to the platform decoded, and carry back its refusal",
    () =>
      Effect.gen(function* () {
        const { calls, refused } = yield* refusedBy(
          readTreePage({
            _splat: "src/format/locale",
            project: "datekit",
            rev: TAG_SEGMENT,
          })
        );

        expect(calls).toStrictEqual([
          { at: TAG, path: "src/format/locale", project: "datekit" },
        ]);
        expect(refused).toStrictEqual(
          Option.some(explain([new UnknownRevision({ rev: TAG })]))
        );
      })
  );

  it.effect(
    "are a not-found carrying the platform's refusal for a project, folder, file, revision or commit it lacks",
    () =>
      Effect.gen(function* () {
        const cases: readonly (readonly [Effect.Effect<Refused>, Refusal])[] = [
          [
            refusedBy(readRefsPage("no-such-project")),
            new UnknownProject({
              project: ProjectName.make("no-such-project"),
            }),
          ],
          [
            refusedBy(
              readTreePage({ _splat: "nope", project: "datekit", rev: "main" })
            ),
            noPath(RepoPath.make("nope")),
          ],
          [
            refusedBy(
              readBlobPage({
                _splat: "nope.ts",
                project: "datekit",
                rev: "main",
              })
            ),
            noPath(RepoPath.make("nope.ts")),
          ],
          [
            refusedBy(readLogPage({ project: "datekit", rev: "v9" })),
            new UnknownRevision({ rev: "v9" }),
          ],
          [
            refusedBy(readCommitPage({ project: "datekit", sha: OLDER })),
            new UnknownCommit({ sha: CommitSha.make(OLDER) }),
          ],
        ];

        for (const [read, refusal] of cases) {
          const { refused } = yield* read;

          expect(refused).toStrictEqual(Option.some(explain([refusal])));
        }
      })
  );

  it.effect(
    "are a not-found with no refusal, and ask nothing, for an address that can name nothing",
    () =>
      Effect.gen(function* () {
        const reads: readonly Effect.Effect<Refused>[] = [
          refusedBy(readRefsPage("Not_A-Project")),
          refusedBy(readTreePage({ project: "datekit", rev: "%E0%A4%A" })),
          refusedBy(readBlobPage({ project: "datekit", rev: "main" })),
          refusedBy(readLogPage({ project: "datekit", rev: "%" })),
          refusedBy(readCommitPage({ project: "datekit", sha: "abc1234" })),
        ];

        for (const read of reads) {
          expect(yield* read).toStrictEqual({
            calls: [],
            refused: Option.none(),
          });
        }
      })
  );

  it.effect("read the log page at `from`, a path's history only", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<readonly Sent[]>([]);

      const read = yield* readLogPage({
        from: 30,
        path: "src/parse.ts",
        project: "datekit",
        rev: "main",
      }).pipe(Effect.provide(platformOf(calls)));

      expect(yield* Ref.get(calls)).toStrictEqual([
        {
          at: "main",
          from: 30,
          limit: LOG_PAGE,
          path: "src/parse.ts",
          project: "datekit",
        },
      ]);
      expect([read.from, read.next, read.path]).toStrictEqual([
        30,
        60,
        "src/parse.ts",
      ]);
    })
  );
});

/** The soft landing a page's read ended in. */
const landingOf = <A, E>(read: Effect.Effect<A, E, Client>) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<readonly Sent[]>([]);

    const failed = yield* Effect.flip(
      read.pipe(Effect.provide(platformOf(calls)))
    );

    return Schema.decodeUnknownOption(SoftLanding)(
      isNotFound(failed) ? failed.data : undefined
    );
  }).pipe(Effect.orDie);

describe("a missing path", () => {
  it.effect(
    "lands on the nearest folder that exists at the commit, with the refusal as its notice",
    () =>
      Effect.gen(function* () {
        const landing = yield* landingOf(
          readBlobPage({
            _splat: "src/format/locale/gone/x.ts",
            project: "datekit",
            rev: "main",
          })
        );

        expect(
          Option.map(landing, ({ nearest }) => nearest.path)
        ).toStrictEqual(Option.some("src/format/locale"));
        expect(
          Option.map(landing, ({ refusals }) => explain(refusals))
        ).toStrictEqual(
          Option.some(
            explain([noPath(RepoPath.make("src/format/locale/gone/x.ts"))])
          )
        );

        const atRoot = yield* landingOf(
          readTreePage({ _splat: "nope", project: "datekit", rev: "main" })
        );

        expect(
          Option.map(atRoot, ({ nearest }) => nearest.path === undefined)
        ).toStrictEqual(Option.some(true));
      })
  );

  it("renders the nearest folder with UnknownPath's own words above it", () => {
    const refusal = noPath(RepoPath.make("src/format/locale/gone/x.ts"));

    const markup = markupOf(
      <CodeNotFound
        data={Schema.encodeSync(SoftLanding)({
          nearest: nested,
          now,
          project: datekit,
          refusals: [refusal],
          rev: "main",
        })}
      />
    );

    const text = textOf(
      <CodeNotFound
        data={Schema.encodeSync(SoftLanding)({
          nearest: nested,
          now,
          project: datekit,
          refusals: [refusal],
          rev: "main",
        })}
      />
    );

    for (const line of explain([refusal])) {
      expect(text).toContain(line.trim());
    }

    expect(markup).toContain('data-refusal="UnknownPath"');
    expect(markup).toContain('data-entry="src/format/locale/en.ts"');
    expect(markup.indexOf('data-refusal="UnknownPath"')).toBeLessThan(
      markup.indexOf('data-entry="src/format/locale/en.ts"')
    );
  });

  it("keeps the Files button on the folder it lands on, so a phone still reaches the tree", () => {
    const data = Schema.encodeSync(SoftLanding)({
      nearest: nested,
      now,
      project: datekit,
      refusals: [noPath(RepoPath.make("src/format/locale/gone/x.ts"))],
      rev: "main",
    });

    const pages = [
      ["tree", TreeRoute],
      ["blob", BlobRoute],
      ["why", WhyRoute],
    ] as const;

    const withoutFiles = pages.flatMap(([page, route]) => {
      const Landing = route.options.notFoundComponent;

      return Landing !== undefined &&
        /aria-haspopup="dialog"[^>]*>[\s\S]*?Files<\/button>/u.test(
          markupOf(<Landing data={data} isNotFound routeId={route.id} />)
        )
        ? []
        : [page];
    });

    expect(withoutFiles).toStrictEqual([]);
  });

  it("keeps any other refusal verbatim, with a way onward", () => {
    const refusal = new UnknownRevision({ rev: "v9" });

    const element = (
      <CodeNotFound data={Schema.encodeSync(Refusals)([refusal])} />
    );

    expect(markupOf(element)).toContain('data-refusal="UnknownRevision"');
    expect(hrefsOf(markupOf(element))).toContain("/");
  });
});

/** The line a code page's route answers its headers with. */
const headersLine = (path: string) =>
  `headers: ({ loaderData, params }) => codePageHeaders(params.${
    path.includes("/commit/") ? "sha" : "rev"
  }, loaderData !== undefined)`;

describe("a code page's caching", () => {
  it("keeps a page at a whole commit id for good, and a page at main or a tag briefly", () => {
    expect(
      [AT, "main", TAG].map((rev) => codePageHeaders(rev, true))
    ).toStrictEqual([immutablePage, branchPage, branchPage]);
  });

  it("keeps a page that found nothing only briefly, even at a whole commit id, since a later landing or import may fill it", () => {
    expect(
      [AT, "main"].map((rev) => codePageHeaders(rev, false))
    ).toStrictEqual([branchPage, branchPage]);
  });

  const routes: Readonly<Record<string, string>> = import.meta.glob(
    "../src/routes/$project/{tree,blob,why}/$rev/$.tsx",
    { eager: true, import: "default", query: "?raw" }
  );

  const logs: Readonly<Record<string, string>> = import.meta.glob(
    "../src/routes/$project/{commits/$rev,commit/$sha}.tsx",
    { eager: true, import: "default", query: "?raw" }
  );

  it("answers each code page with the headers its revision earns, and a commit's for good", () => {
    const pages = { ...routes, ...logs };

    expect(Object.keys(pages)).toHaveLength(5);
    expect(
      Object.entries(pages).flatMap(([path, source]) =>
        source.replaceAll(/\s+/gu, " ").includes(headersLine(path))
          ? []
          : [path]
      )
    ).toStrictEqual([]);
  });
});

describe("the code browser's views", () => {
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/code/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  it("import no transport", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);
    expect(reachingTransport(sources)).toStrictEqual([]);
  });
});
