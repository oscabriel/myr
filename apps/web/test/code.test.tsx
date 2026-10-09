/**
 * The code browser's pages, rendered to HTML with `react-dom/server` from
 * fixtures decoded with the protocol's own schemas: a folder (`TreeView`), a
 * file (`BlobView`), the log (`LogView`), one commit (`CommitView`) and the
 * refs (`RefsView`). Each is what the server sends before the browser
 * loads Pierre: the tree and the highlighted code are client-only, so none
 * of these pages carries a `<file-tree-container` or a `<diffs-container`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
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

import { Refusals } from "../src/features/ask/refused.tsx";
import { BlobView } from "../src/features/code/blob-view.tsx";
import { CommitView } from "../src/features/code/commit-view.tsx";
import { LOG_PAGE, LogView } from "../src/features/code/log-view.tsx";
import { RefsView } from "../src/features/code/refs-view.tsx";
import { TreeView } from "../src/features/code/tree-view.tsx";
import { readBlobPage } from "../src/routes/$project/blob/$rev/$.tsx";
import { readCommitPage } from "../src/routes/$project/commit/$sha.tsx";
import { readLogPage } from "../src/routes/$project/commits/$rev.tsx";
import { readRefsPage } from "../src/routes/$project/refs.tsx";
import { readTreePage } from "../src/routes/$project/tree/$rev/$.tsx";

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

describe(TreeView, () => {
  const page = (
    <TreeView listing={root} project={datekit} readme={readme} rev="main" />
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

  it("links each ancestor in its breadcrumb at the same revision, and names the folder last", () => {
    const markup = markupOf(
      <TreeView listing={nested} project={datekit} rev={TAG} />
    );

    const crumbs = hrefsOf(navOf(markup, 'data-slot="breadcrumb"'));

    expect(crumbs).toStrictEqual([
      `/datekit/tree/${TAG_SEGMENT}`,
      `/datekit/tree/${TAG_SEGMENT}/src`,
      `/datekit/tree/${TAG_SEGMENT}/src/format`,
    ]);
    expect(
      textOf(<TreeView listing={nested} project={datekit} rev={TAG} />)
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
    path: "src/parse.ts",
    sha: "e".repeat(40),
    size: 14,
    text: "one\ntwo\nthree\n",
    truncated: false,
  });

  const page = <BlobView file={parse} project={datekit} rev="main" />;

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

  it("links raw at the commit, why and history at the revision, and the permalink at the commit", () => {
    const toolbar = navOf(markupOf(page), 'data-toolbar="file"');

    expect(hrefsOf(toolbar)).toStrictEqual([
      `/datekit/raw/${AT}/src/parse.ts`,
      "/datekit/why/main/src/parse.ts",
      "/datekit/commits/main?path=src%2Fparse.ts",
      `/datekit/blob/${AT}/src/parse.ts`,
    ]);
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

    const element = <BlobView file={binary} project={datekit} rev="main" />;

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

    const element = <BlobView file={large} project={datekit} rev="main" />;

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
      markupOf(<BlobView file={logo} project={datekit} rev="main" />)
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
      <BlobView file={guide} project={datekit} rev="main" />
    );

    const plain = markupOf(
      <BlobView file={guide} plain project={datekit} rev="main" />
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

  it("groups the commits of one day under one heading", () => {
    const markup = markupOf(page);

    const days = [...markup.matchAll(/data-day="(?<day>[^"]+)"/gu)].map(
      (match) => match.groups?.day
    );

    expect(days).toStrictEqual(["2026-10-06", "2026-10-04"]);

    const first = slice(markup, "data-day", "2026-10-06");

    expect(first).toContain(`data-commit="${LANDED}"`);
    expect(first).toContain(`data-commit="${IMPORTED}"`);
    expect(first).not.toContain(`data-commit="${OLDER}"`);
  });

  it("shows a landing's ask and credit, and links the commit", () => {
    const row = slice(markupOf(page), "data-commit", LANDED);

    expect(hrefsOf(row)).toContain("/datekit/asks/parse-iso-week");
    expect(hrefsOf(row)).toContain(`/datekit/commit/${LANDED}`);
    expect(row).toContain("Asked-by:");
    expect(hrefsOf(row)).toContain("/people/ines-v");
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

describe(CommitView, () => {
  const page = <CommitView diff={diff} now={now} project={datekit} />;

  it("names the people in its trailers, each linking their page", () => {
    const hrefs = hrefsOf(markupOf(page));

    expect(hrefs).toContain("/people/ines-v");
    expect(hrefs).toContain("/people/bram");
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
  });

  it("shows the landing's ask, its answer and its verdict", () => {
    const markup = markupOf(page);

    expect(hrefsOf(markup)).toContain("/datekit/asks/parse-iso-week");
    expect(hrefsOf(markup)).toContain("/datekit/answers/parse-iso-week");
    expect(markup).toContain('data-outcome="Landed"');
  });

  it("links its parent, and counts and names the files it changed", () => {
    const text = textOf(page);

    expect(hrefsOf(markupOf(page))).toContain(`/datekit/commit/${IMPORTED}`);
    expect(text).toContain("3 files changed");

    for (const path of ["src/week.ts", "src/parse.ts", "src/legacy.ts"]) {
      expect(text).toContain(path);
    }

    expect(markupOf(page)).not.toContain("<diffs-container");
    expect(markupOf(page)).not.toContain("<file-tree-container");
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

describe(RefsView, () => {
  const refs = Schema.decodeSync(Refs)({
    forks: [
      {
        ask: "parse-iso",
        handle: "ines-v",
        kind: "claim",
        repo: "datekit--parse-iso--ines-v",
        state: "live",
      },
      { handle: "bram", kind: "working", repo: "datekit--me--bram" },
    ],
    landed: LANDED,
    project: "datekit",
    tags: [
      { name: "v1.1.0", sha: IMPORTED },
      { name: "v1.0.0", sha: OLDER },
    ],
  });

  const page = <RefsView refs={refs} />;

  it("shows main at its landed commit, linked", () => {
    const main = slice(markupOf(page), "data-ref", "main");

    expect(main).toContain(LANDED.slice(0, 7));
    expect(hrefsOf(main)).toContain(`/datekit/commit/${LANDED}`);
  });

  it("lists the tags newest first, each linking its tree", () => {
    const markup = markupOf(page);

    expect(markup.indexOf('data-tag="v1.1.0"')).toBeGreaterThan(-1);
    expect(markup.indexOf('data-tag="v1.1.0"')).toBeLessThan(
      markup.indexOf('data-tag="v1.0.0"')
    );
    expect(hrefsOf(markup)).toContain("/datekit/tree/v1.1.0");
  });

  it("links a claim fork to its answer, with its ask, person and state", () => {
    const fork = slice(
      markupOf(page),
      "data-fork",
      "datekit--parse-iso--ines-v"
    );

    expect(hrefsOf(fork)).toContain("/datekit/answers/parse-iso");
    expect(hrefsOf(fork)).toContain("/people/ines-v");
    expect(fork).toContain("live");
    expect(textOf(page)).toContain("datekit--me--bram");
  });

  it("never names the platform's own refs, and says tags, not releases", () => {
    const text = textOf(page);

    expect(text).not.toContain(Brand.refsPrefix);
    expect(text).not.toContain("refs/notes");
    expect(text.toLowerCase()).not.toContain("release");
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

    const carried = Schema.decodeUnknownOption(Refusals)(
      isNotFound(failed) ? failed.data : undefined
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
