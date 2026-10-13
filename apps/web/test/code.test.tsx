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
import { codeAddressOf } from "../src/features/code/code-address.ts";
import { checkoutCommand } from "../src/features/code/code-bar.tsx";
import { CommitView } from "../src/features/code/commit-view.tsx";
import { FileFacts } from "../src/features/code/file-facts.tsx";
import { filesMatching } from "../src/features/code/file-match.ts";
import { LOG_PAGE } from "../src/features/code/log-page.ts";
import { LogView } from "../src/features/code/log-view.tsx";
import { CodeNotFound } from "../src/features/code/not-found.tsx";
import { SoftLanding } from "../src/features/code/soft-landing.ts";
import { TreeView } from "../src/features/code/tree-view.tsx";
import { ProjectFrame } from "../src/features/project/project-frame.tsx";
import { ProjectHeader } from "../src/features/project/project-header.tsx";
import { Refusals } from "../src/features/shared/refusals.ts";
import { projectTabOf } from "../src/features/shared/shell/sections.ts";
import { ProjectCodeBar } from "../src/routes/$owner/$project/-code-bar.tsx";
import { readBlobPage } from "../src/routes/$owner/$project/blob/$rev/$.tsx";
import { readCommitPage } from "../src/routes/$owner/$project/commit/$sha.tsx";
import { readLogPage } from "../src/routes/$owner/$project/commits/$rev.tsx";
import { readRefsPage } from "../src/routes/$owner/$project/refs.tsx";
import { readTreePage } from "../src/routes/$owner/$project/tree/$rev/$.tsx";
import { elementWith, elementsWith } from "./records.ts";
import { renderAt } from "./render.tsx";
import { reachingTransport } from "./transport.ts";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

const textOf = (element: ReactElement) =>
  markupOf(element)
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/gu, " ");

const hrefsOf = (markup: string) =>
  [...markup.matchAll(/href="(?<href>[^"]*)"/gu)].map((match) =>
    (match.groups?.href ?? "").replaceAll("&amp;", "&")
  );

const slice = (markup: string, marker: string, value: string) => {
  const start = markup.indexOf(`${marker}="${value}"`);
  const next = markup.indexOf(`${marker}="`, start + 1);

  return start === -1
    ? ""
    : markup.slice(start, next === -1 ? undefined : next);
};

const navOf = (markup: string, attribute: string) =>
  new RegExp(`<nav\\b[^>]*${attribute}[^>]*>[\\s\\S]*?</nav>`, "u").exec(
    markup
  )?.[0] ?? "";

const datekit = ProjectName.make("oscabriel/datekit");

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

const factsOf = (markup: string) => elementWith(markup, 'data-facts="inline"');

/** The main region without its facts, which sit inside it. */
const mainOf = (markup: string) => {
  const main = /<main\b[\s\S]*?<\/main>/u.exec(markup)?.[0] ?? "";
  const facts = factsOf(main);

  return facts === "" ? main : main.replace(facts, "");
};

const countIn = (text: string, part: string) => text.split(part).length - 1;

const anchorOf = (markup: string, label: string) =>
  new RegExp(`<a\\b[^>]*>${label}</a>`, "u").exec(markup)?.[0];

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
    expect(hrefsOf(markup)).toContain("/oscabriel/datekit/tree/main/src");
    expect(hrefsOf(markup)).toContain("/oscabriel/datekit/blob/main/README.md");
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
      `/oscabriel/datekit/tree/${TAG_SEGMENT}`,
      `/oscabriel/datekit/tree/${TAG_SEGMENT}/src`,
      `/oscabriel/datekit/tree/${TAG_SEGMENT}/src/format`,
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

  it.effect(
    "links the folder's history with its path as the search, current on that page",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          `/oscabriel/datekit/commits/${TAG_SEGMENT}?path=src%2Fformat%2Flocale`,
          <TreeView listing={nested} now={now} project={datekit} rev={TAG} />
        );

        const history = anchorOf(markup, "History");

        expect(history).toContain(
          `href="/oscabriel/datekit/commits/${TAG_SEGMENT}?path=src%2Fformat%2Flocale"`
        );
        expect(history).toContain('aria-current="page"');
      })
  );
});

const permalink = (mode: "code" | "why") =>
  /href="(?<href>[^"]*)"[^>]*>Permalink</u.exec(
    markupOf(
      <FileFacts
        file={readme}
        mode={mode}
        now={now}
        project={datekit}
        rev="main"
      />
    )
  )?.groups?.href;

describe("a file's facts", () => {
  it("link a permalink to the page they sit on: the code, or why", () => {
    expect(permalink("code")).toBe(`/oscabriel/datekit/blob/${AT}/README.md`);
    expect(permalink("why")).toBe(`/oscabriel/datekit/why/${AT}/README.md`);
  });

  // The history's `?path=` is the address's search, not part of its path:
  // the router then reads `main` as the revision (a hover fetches the right
  // page) and marks the link on the history it leads to.
  it.effect(
    "link the file's history with its path as the search, current on that page",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/datekit/commits/main?path=README.md",
          <FileFacts file={readme} now={now} project={datekit} rev="main" />
        );

        const history = anchorOf(markup, "History of this file");

        expect(history).toContain(
          'href="/oscabriel/datekit/commits/main?path=README.md"'
        );
        expect(history).toContain('aria-current="page"');
      })
  );
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

    expect(
      countIn(main.replaceAll(/<[^>]+>/gu, ""), "src/format/parse.ts")
    ).toBe(1);
    expect(countIn(main, 'title="src/format/parse.ts"')).toBe(1);
    expect(countIn(main, 'aria-label="Path"')).toBe(1);
    expect(hrefsOf(navOf(main, 'aria-label="Path"'))).toStrictEqual([
      "/oscabriel/datekit/tree/main",
      "/oscabriel/datekit/tree/main/src",
      "/oscabriel/datekit/tree/main/src/format",
    ]);
  });

  it("has the Code | Why toggle, Code current", () => {
    const toggle = navOf(markupOf(page), 'aria-label="Mode"');

    expect(hrefsOf(toggle)).toStrictEqual([
      "/oscabriel/datekit/blob/main/src/format/parse.ts",
      "/oscabriel/datekit/why/main/src/format/parse.ts",
    ]);
    expect(toggle).toMatch(/aria-current="page"[^>]*>Code</u);
    expect(toggle).not.toMatch(/aria-current="page"[^>]*>Why</u);
  });

  it("links raw at the commit and the permalink at the commit, and the history at the revision", () => {
    const markup = markupOf(page);
    const toolbar = navOf(markup, 'data-toolbar="file"');

    expect(hrefsOf(toolbar)).toStrictEqual([
      `/oscabriel/datekit/raw/${AT}/src/format/parse.ts`,
      `/oscabriel/datekit/blob/${AT}/src/format/parse.ts`,
    ]);
    expect(hrefsOf(factsOf(markup))).toContain(
      "/oscabriel/datekit/commits/main?path=src%2Fformat%2Fparse.ts"
    );
  });

  it("names the last landing's ask in This file, before its SHA", () => {
    const facts = factsOf(markupOf(page));
    const text = facts.replaceAll(/<[^>]+>/gu, "");

    expect(facts).toContain("This file");
    expect(text.indexOf("parse-iso-week")).toBeGreaterThan(-1);
    expect(text.indexOf("parse-iso-week")).toBeLessThan(
      text.indexOf(LANDED.slice(0, 7))
    );
    expect(text).toContain("answered by bram");
    expect(hrefsOf(facts)).toStrictEqual(
      expect.arrayContaining([
        "/oscabriel/datekit/asks/parse-iso-week",
        "/oscabriel/datekit/answers/parse-iso-week",
        `/oscabriel/datekit/commit/${LANDED}`,
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
      `/oscabriel/datekit/raw/${AT}/assets/fixture.bin`
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
      `/oscabriel/datekit/raw/${AT}/data/zones.json`
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
      new RegExp(
        `<img\\b[^>]*src="/oscabriel/datekit/raw/${AT}/docs/logo.png"`,
        "u"
      )
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
      "/oscabriel/datekit/blob/main/docs/guide.md?plain=1"
    );
    expect(plain).toContain('id="L3"');
    expect(plain).not.toContain("data-readme=");
  });
});

const platformUrl = "https://platform-test.example.workers.dev";

/** A code page as the project's layout draws it: the frame, the project's header and its tab from the path, then the page. */
const inCodeTab = (url: string, page: ReactElement, head?: Commit) =>
  renderAt(
    url,
    <ProjectFrame
      header={
        <ProjectHeader
          current={projectTabOf(new URL(url, platformUrl).pathname)}
          header={{ now, project: datekit }}
          platformUrl={platformUrl}
        />
      }
      codeBar={<ProjectCodeBar platformUrl={platformUrl} />}
    >
      {page}
    </ProjectFrame>,
    {
      loaderData:
        head === undefined
          ? undefined
          : {
              head: Schema.encodeSync(Commit)(head),
              now: DateTime.formatIso(now),
            },
    }
  );

const codeBarOf = (markup: string) => elementWith(markup, 'data-code-bar=""');

const parseTs = decodeFile({
  at: AT,
  binary: false,
  path: "src/format/parse.ts",
  sha: "e".repeat(40),
  size: 14,
  text: "one\ntwo\nthree\n",
  truncated: false,
});

const treeAndBlob = Effect.all([
  inCodeTab(
    "/oscabriel/datekit/tree/main/src/format/locale",
    <TreeView listing={nested} now={now} project={datekit} rev="main" />
  ),
  inCodeTab(
    "/oscabriel/datekit/blob/main/src/format/parse.ts",
    <BlobView file={parseTs} now={now} project={datekit} rev="main" />
  ),
]);

/** Each link of a control, with whether it is marked as the page being read. */
const linksIn = (markup: string) =>
  [...markup.matchAll(/<a\b(?<attributes>[^>]*)>(?<text>[\s\S]*?)<\/a>/gu)].map(
    ({ groups }) => ({
      current: /aria-current="page"/u.test(groups?.attributes ?? ""),
      href: hrefsOf(groups?.attributes ?? "")[0],
      text: (groups?.text ?? "").replaceAll(/<[^>]+>/gu, "").trim(),
    })
  );

describe("a code page in the Code tab", () => {
  it.effect(
    "keeps the project header, with Code its current tab, over the code bar",
    () =>
      Effect.gen(function* () {
        const pages = yield* treeAndBlob;

        expect(
          pages.map(
            (markup) =>
              elementWith(markup, 'data-project-header=""') !== "" &&
              /aria-current="page"[^>]*>Code</u.test(
                elementWith(markup, 'data-project-tabs=""')
              )
          )
        ).toStrictEqual([true, true]);
        expect(
          pages.map(
            (markup) =>
              markup.indexOf('data-project-header=""') <
              markup.indexOf('data-code-bar=""')
          )
        ).toStrictEqual([true, true]);
      })
  );

  it.effect(
    "has the Files/Commits toggle, Files current, and the ref switcher on main",
    () =>
      Effect.gen(function* () {
        const bars = (yield* treeAndBlob).map(codeBarOf);

        expect(
          bars.map((bar) =>
            linksIn(navOf(bar, 'aria-label="Files or commits"'))
          )
        ).toStrictEqual(
          bars.map(() => [
            {
              current: true,
              href: "/oscabriel/datekit/tree/main",
              text: "Files",
            },
            {
              current: false,
              href: "/oscabriel/datekit/commits/main",
              text: "Commits",
            },
          ])
        );
        expect(
          bars.map((bar) => /<button\b[^>]*data-ref="main"[^>]*>/u.test(bar))
        ).toStrictEqual([true, true]);
      })
  );

  it.effect(
    "draws no Menu control: the top bar's links stay where they are",
    () =>
      Effect.gen(function* () {
        const pages = yield* treeAndBlob;

        expect(
          pages.flatMap((markup) => [
            ...elementsWith(markup, '(?:aria-label|title)="[^"]*Menu'),
            ...[...markup.matchAll(/>\s*Menu\s*</gu)].map(([found]) => found),
          ])
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "shows the revision's head commit in the bar: its short id and subject linking it, then its author",
    () =>
      Effect.gen(function* () {
        const [head] = commits;

        const bar = codeBarOf(
          yield* inCodeTab(
            "/oscabriel/datekit/tree/main",
            <TreeView listing={root} now={now} project={datekit} rev="main" />,
            head
          )
        );

        const shown = elementWith(bar, `data-head-commit="${LANDED}"`);

        expect(
          linksIn(shown).map(({ href, text }) => [href, text])
        ).toStrictEqual([
          [`/oscabriel/datekit/commit/${LANDED}`, LANDED.slice(0, 7)],
          [`/oscabriel/datekit/commit/${LANDED}`, "Answer parse-iso-week"],
        ]);
        expect(shown).toContain("Bram");
      })
  );

  it.effect(
    "marks Commits on the history and on a commit, at the same revision, and nothing on the refs list",
    () =>
      Effect.gen(function* () {
        const pages = yield* Effect.forEach(
          [
            `/oscabriel/datekit/commits/${TAG_SEGMENT}`,
            `/oscabriel/datekit/commit/${LANDED}`,
            "/oscabriel/datekit/refs",
          ],
          (url) => inCodeTab(url, <main id="main" />)
        );

        const toggles = pages.map((markup) =>
          linksIn(navOf(codeBarOf(markup), 'aria-label="Files or commits"'))
        );

        expect(
          toggles.map((links) =>
            links.flatMap(({ current, text }) => (current ? [text] : []))
          )
        ).toStrictEqual([["Commits"], ["Commits"], []]);
        expect(toggles[0]?.map(({ href }) => href)).toStrictEqual([
          `/oscabriel/datekit/tree/${TAG_SEGMENT}`,
          `/oscabriel/datekit/commits/${TAG_SEGMENT}`,
        ]);
      })
  );

  it.effect("draws no code bar on a page of another tab", () =>
    Effect.gen(function* () {
      const pages = yield* Effect.forEach(
        ["/oscabriel/datekit", "/oscabriel/datekit/asks/parse-iso-week"],
        (url) => inCodeTab(url, <main id="main" />)
      );

      expect(pages.map(codeBarOf)).toStrictEqual(["", ""]);
    })
  );

  it.effect(
    "opens the file tree from the bar's Tree button below the columns, and offers Go to file and Clone",
    () =>
      Effect.gen(function* () {
        const [tree] = yield* treeAndBlob;
        const bar = codeBarOf(tree);

        expect(bar).toMatch(
          /class="columns:hidden[^"]*"><button[^>]*aria-haspopup="dialog"[^>]*>[\s\S]*?Tree<\/button>/u
        );
        expect(bar).toMatch(/title="Go to file \(t\)"/u);
        expect(bar).toContain('data-action="clone-here"');
      })
  );

  it.effect(
    "gives the blob page's file header a Why toggle to the why page for the same path and revision",
    () =>
      Effect.gen(function* () {
        const [, blob] = yield* treeAndBlob;
        const toggle = navOf(blob, 'aria-label="Mode"');

        expect(linksIn(toggle).find(({ text }) => text === "Why")?.href).toBe(
          "/oscabriel/datekit/why/main/src/format/parse.ts"
        );
        expect(elementWith(blob, 'data-toolbar=""')).toContain(
          'aria-label="Mode"'
        );
      })
  );
});

describe(codeAddressOf, () => {
  it.each([
    [
      "/oscabriel/datekit/tree/main",
      { page: "tree", path: undefined, rev: "main" },
    ],
    [
      `/oscabriel/datekit/blob/${TAG_SEGMENT}/src/a%20b.ts`,
      { page: "blob", path: "src/a b.ts", rev: TAG },
    ],
    [
      "/oscabriel/datekit/why/main/src/parse.ts",
      { page: "why", path: "src/parse.ts", rev: "main" },
    ],
    [
      `/oscabriel/datekit/commit/${LANDED}`,
      { page: "commit", path: undefined, rev: LANDED },
    ],
    ["/oscabriel/datekit/refs", { page: "refs", rev: "main" }],
  ])("reads %s", (pathname, address) => {
    expect(codeAddressOf(pathname)).toStrictEqual(Option.some(address));
  });

  it("reads no address off the Code tab", () => {
    expect(
      [
        "/oscabriel/datekit",
        "/oscabriel/datekit/asks/parse-iso-week",
        "/oscabriel/datekit/tree",
      ].map((pathname) => Option.isNone(codeAddressOf(pathname)))
    ).toStrictEqual([true, true, true]);
  });
});

describe(filesMatching, () => {
  const paths = [
    "src/format/locale/en.ts",
    "src/parse.ts",
    "test/parse.test.ts",
    "README.md",
  ];

  it("keeps the paths holding every word, a match in the file's own name first", () => {
    expect(filesMatching(paths, "parse")).toStrictEqual([
      "src/parse.ts",
      "test/parse.test.ts",
    ]);
    expect(filesMatching(paths, "src ts")).toStrictEqual([
      "src/parse.ts",
      "src/format/locale/en.ts",
    ]);
  });

  it("matches without regard to case, and stops at its limit", () => {
    expect(filesMatching(paths, "readme")).toStrictEqual(["README.md"]);
    expect(filesMatching(paths, "", 2)).toHaveLength(2);
  });
});

describe(checkoutCommand, () => {
  it("checks out a tag or a commit as it is, and quotes anything else", () => {
    expect(checkoutCommand(TAG)).toBe(`git checkout ${TAG}`);
    expect(checkoutCommand(LANDED)).toBe(`git checkout ${LANDED}`);
    expect(checkoutCommand("v1;rm -rf ~")).toBe("git checkout 'v1;rm -rf ~'");
    expect(checkoutCommand("it's")).toBe(`git checkout 'it'\\''s'`);
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
        "/oscabriel/datekit/asks/parse-iso-week",
        `/oscabriel/datekit/commit/${LANDED}`,
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

    expect(hrefsOf(row)).toContain("/oscabriel/datekit/asks/parse-iso-week");
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
      "/oscabriel/datekit/commits/main",
      "/oscabriel/datekit/commits/main?show=answers",
      "/oscabriel/datekit/commits/main?show=openings",
    ]);
    expect(filters).toMatch(/aria-current="page"[^>]*>All</u);
  });

  it("says an imported commit came before adoption", () => {
    const row = slice(markupOf(page), "data-commit", IMPORTED);

    expect(row).toContain("before adoption");
    expect(hrefsOf(row)).toContain(`/oscabriel/datekit/commit/${IMPORTED}`);
    expect(slice(markupOf(page), "data-commit", LANDED)).not.toContain(
      "before adoption"
    );
  });

  it("links the older page from where this one ends, and no newer page from the first", () => {
    const pager = navOf(markupOf(page), 'data-slot="pagination"');

    expect(hrefsOf(pager)).toStrictEqual([
      "/oscabriel/datekit/commits/main?from=30",
    ]);
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
      "/oscabriel/datekit/commits/main?path=src%2Fparse.ts",
      "/oscabriel/datekit/commits/main?path=src%2Fparse.ts&from=60",
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
      "/oscabriel/datekit/commits/main?show=answers",
      "/oscabriel/datekit/commits/main?from=60&show=answers",
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
      "/oscabriel/datekit/commits/main?path=src%2Fparse.ts",
      "/oscabriel/datekit/commits/main?path=src%2Fparse.ts&from=430",
    ]);
  });
});

const linesUpTo = (count: number) =>
  `${Array.from({ length: count }, (_, index) => `line ${index + 1}`).join(
    "\n"
  )}\n`;

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
    expect(hrefsOf(markup)).toContain("/oscabriel/datekit/asks/parse-iso-week");
    expect(hrefsOf(markup)).toContain(
      "/oscabriel/datekit/answers/parse-iso-week"
    );
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

    expect(hrefsOf(markup)).toContain("/oscabriel/datekit/asks/parse-iso-week");
    expect(hrefsOf(markup)).not.toContain(
      "/oscabriel/datekit/answers/parse-iso-week"
    );
    expect(markup).toContain("opened");
  });

  it("puts git's own facts on one line: author, committer and parent, linked", () => {
    const text = textOf(page);

    expect(hrefsOf(markupOf(page))).toContain(
      `/oscabriel/datekit/commit/${IMPORTED}`
    );
    expect(text).toContain("authored by Bram");
    expect(text).toContain("committed by the platform");
    expect(text).toContain(`parent ${IMPORTED.slice(0, 7)}`);
  });

  it("ends its head's meta line with the files and lines it changed, linking the diff", () => {
    const markup = markupOf(page);

    const meta =
      /<div class="text-ui text-muted-foreground">[\s\S]*?<\/div>/u.exec(
        markup
      )?.[0] ?? "";

    expect(
      meta
        .replaceAll(/<[^>]+>/gu, " ")
        .replaceAll(/\s+/gu, " ")
        .trim()
    ).toMatch(/Browse files · \d+ files? · \+\d+ added −\d+ removed$/u);
    expect(meta).toMatch(/<a\b[^>]*href="#diff"/u);
    expect(meta).toContain("text-diff-add-sign");
    expect(markup).toMatch(/<div\b[^>]*id="diff"/u);
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
    const facts = factsOf(
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

type Sent = Rpc.Payload<Contract>;

const knownProject = (name: ProjectName) =>
  name === datekit
    ? Effect.void
    : Effect.fail(new UnknownProject({ project: name }));

const knownRevision = (at: string | undefined) =>
  at === undefined || at === "main" || at === AT
    ? Effect.void
    : Effect.fail(new UnknownRevision({ rev: at }));

const landedOnly = Schema.decodeSync(Refs)({
  forks: [],
  landed: LANDED,
  project: "datekit",
  tags: [],
});

const noPath = (path: RepoPath) =>
  new UnknownPath({ commit: CommitSha.make(AT), path });

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

interface Refused {
  readonly calls: readonly Sent[];
  readonly refused: Option.Option<readonly string[]>;
}

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
  it.effect(
    "read a folder, its README and the revision's head for the folder's page, and no entry's last change",
    () =>
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
        expect(read.head?.sha).toBe(LANDED);
        // The entries' last changes are the browser's to read, after the page is up.
        expect(
          (yield* Ref.get(calls)).filter((call) => "limit" in call)
        ).toStrictEqual([
          { at: "main", limit: 1, project: "oscabriel/datekit" },
        ]);
      })
  );

  it.effect(
    "pass a tag's name to the platform decoded, and carry back its refusal",
    () =>
      Effect.gen(function* () {
        const { calls, refused } = yield* refusedBy(
          readTreePage({
            _splat: "src/format/locale",
            project: "oscabriel/datekit",
            rev: TAG_SEGMENT,
          })
        );

        expect(calls).toStrictEqual([
          { at: TAG, path: "src/format/locale", project: "oscabriel/datekit" },
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
            refusedBy(readRefsPage("oscabriel/no-such-project")),
            new UnknownProject({
              project: ProjectName.make("oscabriel/no-such-project"),
            }),
          ],
          [
            refusedBy(
              readTreePage({
                _splat: "nope",
                project: "oscabriel/datekit",
                rev: "main",
              })
            ),
            noPath(RepoPath.make("nope")),
          ],
          [
            refusedBy(
              readBlobPage({
                _splat: "nope.ts",
                project: "oscabriel/datekit",
                rev: "main",
              })
            ),
            noPath(RepoPath.make("nope.ts")),
          ],
          [
            refusedBy(readLogPage({ project: "oscabriel/datekit", rev: "v9" })),
            new UnknownRevision({ rev: "v9" }),
          ],
          [
            refusedBy(
              readCommitPage({ project: "oscabriel/datekit", sha: OLDER })
            ),
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
          refusedBy(
            readTreePage({ project: "oscabriel/datekit", rev: "%E0%A4%A" })
          ),
          refusedBy(
            readBlobPage({ project: "oscabriel/datekit", rev: "main" })
          ),
          refusedBy(readLogPage({ project: "oscabriel/datekit", rev: "%" })),
          refusedBy(
            readCommitPage({ project: "oscabriel/datekit", sha: "abc1234" })
          ),
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
        project: "oscabriel/datekit",
        rev: "main",
      }).pipe(Effect.provide(platformOf(calls)));

      // The page, and the revision's head for the code bar beside it.
      expect(
        (yield* Ref.get(calls)).toSorted((one, other) =>
          JSON.stringify(one).localeCompare(JSON.stringify(other))
        )
      ).toStrictEqual([
        {
          at: "main",
          from: 30,
          limit: LOG_PAGE,
          path: "src/parse.ts",
          project: "oscabriel/datekit",
        },
        { at: "main", limit: 1, project: "oscabriel/datekit" },
      ]);
      expect([read.from, read.next, read.path]).toStrictEqual([
        30,
        60,
        "src/parse.ts",
      ]);
    })
  );
});

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

  it.effect(
    "keeps the code bar's Tree button over the folder it lands on, so a phone still reaches the tree",
    () =>
      Effect.gen(function* () {
        const data = yield* Schema.encodeEffect(SoftLanding)({
          nearest: nested,
          now,
          project: datekit,
          refusals: [noPath(RepoPath.make("src/format/locale/gone/x.ts"))],
          rev: "main",
        });

        const pages = yield* Effect.forEach(
          ["tree", "blob", "why"] as const,
          (page) =>
            inCodeTab(
              `/oscabriel/datekit/${page}/main/src/format/locale/gone/x.ts`,
              <CodeNotFound data={data} />
            )
        );

        expect(
          pages.map((markup) =>
            /aria-haspopup="dialog"[^>]*>[\s\S]*?Tree<\/button>/u.test(
              codeBarOf(markup)
            )
          )
        ).toStrictEqual([true, true, true]);
      })
  );

  it("keeps any other refusal verbatim, with a way onward", () => {
    const refusal = new UnknownRevision({ rev: "v9" });

    const element = (
      <CodeNotFound data={Schema.encodeSync(Refusals)([refusal])} />
    );

    expect(markupOf(element)).toContain('data-refusal="UnknownRevision"');
    expect(hrefsOf(markupOf(element))).toContain("/asks");
  });
});

const HEADERS_LINE = "headers: () => branchPage";

describe("a code page's caching", () => {
  // A commit's page carries its landing, recorded after main has moved, and times reckoned from the read,
  // so it is never kept for good.
  const routes: Readonly<Record<string, string>> = import.meta.glob(
    "../src/routes/$owner/$project/{tree,blob,why}/$rev/$.tsx",
    { eager: true, import: "default", query: "?raw" }
  );

  const logs: Readonly<Record<string, string>> = import.meta.glob(
    "../src/routes/$owner/$project/{commits/$rev,commit/$sha}.tsx",
    { eager: true, import: "default", query: "?raw" }
  );

  it("keeps each code page briefly, even at a whole commit id, and reads it again behind it", () => {
    const pages = { ...routes, ...logs };

    expect(Object.keys(pages)).toHaveLength(5);
    expect(
      Object.entries(pages).flatMap(([path, source]) =>
        source.replaceAll(/\s+/gu, " ").includes(HEADERS_LINE) &&
        !source.includes("immutable")
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
