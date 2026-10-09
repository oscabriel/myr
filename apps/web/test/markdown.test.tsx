/**
 * A project's Markdown file, rendered to HTML with `react-dom/server`, as
 * the Worker renders it: GitHub-flavoured Markdown and the README's own
 * HTML, its links and images pointing into the project at the commit it
 * was read at, and nothing that could run script or post a form.
 */
import { describe, expect, it } from "@effect/vitest";
import { CommitSha, ProjectName } from "@repo/protocol/ids";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import {
  RepoMarkdown,
  RepoText,
  isMarkdownPath,
} from "../src/features/markdown/markdown.tsx";

const sha = CommitSha.make("0123456789abcdef0123456789abcdef01234567");

const project = ProjectName.make("p");

/** The file `<dir>/README.md` at `sha`, rendered with no router around it, as a view's test renders it. */
const rendered = (source: string, dir = "") =>
  renderToString(
    <RepoMarkdown at={sha} dir={dir} project={project} source={source} />
  );

/** The same, inside a router at `location`, as the app renders it. */
const routed = (element: ReactElement, location = "/p") =>
  renderToString(
    <RouterContextProvider
      router={createRouter({
        history: createMemoryHistory({ initialEntries: [location] }),
        routeTree: createRootRoute(),
      })}
    >
      {element}
    </RouterContextProvider>
  );

/** Each `<a …>` opening tag in `markup`. */
const anchorsOf = (markup: string) => markup.match(/<a\b[^>]*>/gu) ?? [];

describe("what a README cannot carry", () => {
  it("drops a script and what it says", () => {
    const markup = rendered("before\n\n<script>alert(1)</script>\n\nafter");

    expect(markup).not.toContain("script");
    expect(markup).not.toContain("alert");
    expect(markup).toContain("<p>after</p>");
  });

  it("keeps an image but not its event handler", () => {
    const markup = rendered("<img src=x onerror=alert(1)>");

    expect(markup).toContain(`src="/p/raw/${sha}/x"`);
    expect(markup).not.toContain("onerror");
    expect(markup).not.toContain("alert");
  });

  it.each([
    ["a javascript: link", "[x](javascript:alert(1))"],
    ["a data: link", '<a href="data:text/html,<b>hi</b>">x</a>'],
    ["a vbscript: link", "[x](vbscript:msgbox(1))"],
  ])("renders %s with no href", (_, source) => {
    const markup = rendered(source);

    expect(anchorsOf(markup)).toStrictEqual(["<a>"]);
    expect(markup).not.toMatch(/javascript|data:|vbscript/u);
  });

  it.each([
    ["an iframe", '<iframe src="https://e.org"></iframe>', "iframe"],
    ["a style", "<style>body{display:none}</style>", "<style"],
    ["a form", '<form action="/x"><input name="q"></form>', "action"],
  ])("drops %s", (_, source, word) => {
    const markup = rendered(`${source}\n\nafter`);

    expect(markup).not.toContain(word);
    expect(markup).toContain("<p>after</p>");
  });

  it("prefixes a name the README sets, so it cannot clobber the page's own", () => {
    const markup = rendered('<a name="top">Top</a>');

    expect(markup).toMatch(/(?:id|name)="user-content-top"/u);
  });
});

/** `docs/README.md`, rendered. */
const readme = (source: string) => rendered(source, "docs");

describe("links and images in docs/README.md", () => {
  it("loads a relative image raw from the README's folder, at the SHA", () => {
    const markup = readme("![logo](./img/logo.png)");

    expect(markup).toContain(`src="/p/raw/${sha}/docs/img/logo.png"`);
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
  });

  it.each([
    ["[a](../../x)", `/p/blob/${sha}/x`],
    ["[b](/LICENSE)", `/p/blob/${sha}/LICENSE`],
    ["[g](guide.md#install)", `/p/blob/${sha}/docs/guide.md#install`],
  ])("opens %s inside the project", (source, href) => {
    expect(anchorsOf(readme(source))).toStrictEqual([`<a href="${href}">`]);
  });

  it("opens a link inside the project through the router when there is one", () => {
    const markup = routed(
      <RepoMarkdown
        at={sha}
        dir="docs"
        project={project}
        source="[a](../../x?raw=1#L3)"
      />
    );

    expect(anchorsOf(markup)).toStrictEqual([
      `<a href="/p/blob/${sha}/x?raw=1#L3">`,
    ]);
  });

  it("marks a link to the page it is on as the current page, its query and fragment read as such", () => {
    const markup = routed(
      <RepoMarkdown
        at={sha}
        dir="docs"
        project={project}
        source="[a](../../x?raw=1#L3)"
      />,
      `/p/blob/${sha}/x?raw=1#L3`
    );

    const [anchor] = anchorsOf(markup);

    expect(anchor).toContain(`href="/p/blob/${sha}/x?raw=1#L3"`);
    expect(anchor).toContain('aria-current="page"');
  });

  it("leaves an external link as written, opened with no referrer", () => {
    const [anchor] = anchorsOf(readme("[c](https://e.org)"));

    expect(anchor).toContain('href="https://e.org"');
    expect(anchor).toMatch(/rel="[^"]*\bnoopener\b[^"]*"/u);
    expect(anchor).toMatch(/rel="[^"]*\bnofollow\b[^"]*"/u);
    expect(anchor).toMatch(/rel="[^"]*\bnoreferrer\b[^"]*"/u);
  });

  it("leaves a link to a heading as written", () => {
    expect(anchorsOf(readme("[d](#usage)"))).toStrictEqual([
      '<a href="#usage">',
    ]);
  });

  it("resolves an image in the README's own HTML, as ky's and awesome's are written", () => {
    const markup = rendered(
      '<p align="center"><img src="media/logo.svg" width="200" alt="logo"></p>'
    );

    expect(markup).toContain(`src="/p/raw/${sha}/media/logo.svg"`);
    expect(markup).toContain('align="center"');
  });

  it("resolves a picture's sources too, so the dark logo loads", () => {
    const markup = rendered(
      '<picture><source media="(prefers-color-scheme: dark)" srcset="media/dark.svg 1x, media/dark@2x.svg 2x"><img src="media/logo.svg"></picture>'
    );

    expect(markup).toContain(
      `srcSet="/p/raw/${sha}/media/dark.svg 1x, /p/raw/${sha}/media/dark@2x.svg 2x"`
    );
    expect(markup).toContain(`src="/p/raw/${sha}/media/logo.svg"`);
  });
});

describe("GitHub-flavoured Markdown", () => {
  it("renders a table", () => {
    const markup = rendered("| a | b |\n| - | - |\n| 1 | 2 |");

    expect(markup).toContain("<table>");
    expect(markup).toContain("<td>1</td>");
  });

  it("renders a task list with checkboxes nobody can tick", () => {
    const markup = rendered("- [x] done\n- [ ] not yet");

    expect(markup.match(/<input[^>]*>/gu)).toStrictEqual([
      '<input type="checkbox" disabled="" checked=""/>',
      '<input type="checkbox" disabled=""/>',
    ]);
  });

  it("gives a heading an id a link can point at", () => {
    expect(rendered("## Hello World")).toContain('<h2 id="hello-world">');
  });

  it("keeps a code block's language and draws it in mono", () => {
    const markup = rendered("```ts\nconst a = 1;\n```");

    expect(markup).toContain('class="language-ts"');
    expect(markup).toContain("<pre");
  });

  it("styles the whole as prose", () => {
    expect(rendered("hi")).toMatch(/class="[^"]*\bprose\b[^"]*"/u);
  });
});

describe("a README that is not Markdown", () => {
  it.each([
    ["README.md", true],
    ["docs/readme.markdown", true],
    ["README.mdown", true],
    ["README", false],
    ["README.txt", false],
    ["README.rst", false],
  ])("reads %s as Markdown: %s", (path, markdown) => {
    expect(isMarkdownPath(path)).toBe(markdown);
  });

  it("shows as written, in a pre", () => {
    const markup = renderToString(<RepoText source={"# not a heading\n<b>"} />);

    expect(markup).toMatch(/^<pre[^>]*># not a heading\n&lt;b&gt;<\/pre>$/u);
  });
});
