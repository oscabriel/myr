import { describe, expect, it } from "@effect/vitest";
import { CommitSha, ProjectName } from "@repo/protocol/ids";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { Effect } from "effect";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import {
  RepoMarkdown,
  RepoText,
  isMarkdownPath,
} from "../src/features/markdown/markdown.tsx";
import { renderAt } from "./render.tsx";

const sha = CommitSha.make("0123456789abcdef0123456789abcdef01234567");

const project = ProjectName.make("oscabriel/p");

const rendered = (source: string, dir = "") =>
  renderToString(
    <RepoMarkdown at={sha} dir={dir} project={project} source={source} />
  );

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

    expect(markup).toContain(`src="/oscabriel/p/raw/${sha}/x"`);
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

  it("drops a style's CSS with the element, so no stray rules show as text", () => {
    const markup = rendered("<style>body{display:none}</style>\n\nafter");

    expect(markup).not.toContain("display:none");
    expect(markup).toContain("<p>after</p>");
  });

  it("prefixes a name the README sets, so it cannot clobber the page's own", () => {
    const markup = rendered('<a name="top">Top</a>');

    expect(markup).toMatch(/(?:id|name)="user-content-top"/u);
  });
});

const readme = (source: string) => rendered(source, "docs");

describe("links and images in docs/README.md", () => {
  it("loads a relative image raw from the README's folder, at the SHA", () => {
    const markup = readme("![logo](./img/logo.png)");

    expect(markup).toContain(`src="/oscabriel/p/raw/${sha}/docs/img/logo.png"`);
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
  });

  it.each([
    ["[a](../../x)", `/oscabriel/p/blob/${sha}/x`],
    ["[b](/LICENSE)", `/oscabriel/p/blob/${sha}/LICENSE`],
    ["[g](guide.md#install)", `/oscabriel/p/blob/${sha}/docs/guide.md#install`],
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
      `<a href="/oscabriel/p/blob/${sha}/x?raw=1#L3">`,
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
      `/oscabriel/p/blob/${sha}/x?raw=1#L3`
    );

    const [anchor] = anchorsOf(markup);

    expect(anchor).toContain(`href="/oscabriel/p/blob/${sha}/x?raw=1#L3"`);
    expect(anchor).toContain('aria-current="page"');
  });

  // A file's path may hold the router's own marks (`routes/$project/…`,
  // `bin/$.sh`): they are the file's name, never a param the router fills
  // from the page being read.
  it.effect(
    "opens a path holding $ or braces as the README names it, inside the app's router",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/p",
          <RepoMarkdown
            at={sha}
            dir=""
            project={project}
            source="[r](src/routes/$owner/$project/index.tsx) [s](bin/$.sh) [o](src/{-$x}.ts#L2)"
          />
        );

        expect(
          anchorsOf(markup).map((anchor) =>
            decodeURIComponent(
              /href="(?<href>[^"]*)"/u.exec(anchor)?.groups?.href ?? ""
            )
          )
        ).toStrictEqual([
          `/oscabriel/p/blob/${sha}/src/routes/$owner/$project/index.tsx`,
          `/oscabriel/p/blob/${sha}/bin/$.sh`,
          `/oscabriel/p/blob/${sha}/src/{-$x}.ts#L2`,
        ]);
      })
  );

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

    expect(markup).toContain(`src="/oscabriel/p/raw/${sha}/media/logo.svg"`);
    expect(markup).toContain('align="center"');
  });

  it("resolves a picture's sources too, so the dark logo loads", () => {
    const markup = rendered(
      '<picture><source media="(prefers-color-scheme: dark)" srcset="media/dark.svg 1x, media/dark@2x.svg 2x"><img src="media/logo.svg"></picture>'
    );

    expect(markup).toContain(
      `srcSet="/oscabriel/p/raw/${sha}/media/dark.svg 1x, /oscabriel/p/raw/${sha}/media/dark@2x.svg 2x"`
    );
    expect(markup).toContain(`src="/oscabriel/p/raw/${sha}/media/logo.svg"`);
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

  // A README sits under the project's own h1, so its levels go down by one.
  it("gives a heading an id a link can point at, a level under the page's h1", () => {
    expect(rendered("## Hello World")).toContain('<h3 id="hello-world">');
  });

  it("draws no h1 of its own, and keeps an h6 an h6", () => {
    const markup = rendered("# burrow\n\n###### Small");

    expect(markup).not.toContain("<h1");
    expect(markup).toContain('<h2 id="burrow">');
    expect(markup).toContain('<h6 id="small">');
  });

  describe("a footnote", () => {
    const markup = rendered("Text[^1]\n\n[^1]: Note.");

    const targetOf = (attribute: string) =>
      anchorsOf(markup)
        .find((anchor) => anchor.includes(attribute))
        ?.match(/href="#(?<id>[^"]+)"/u)?.groups?.id;

    const idOf = (attribute: string) =>
      new RegExp(`<[a-z]+\\b[^>]*${attribute}[^>]*>`, "u")
        .exec(markup)?.[0]
        .match(/\bid="(?<id>[^"]+)"/u)?.groups?.id;

    it("is referenced by a link that jumps to it", () => {
      const target = targetOf("data-footnote-ref");

      expect(target).toBeDefined();
      expect(markup).toContain(`<li id="${target}">`);
    });

    it("links back to its reference", () => {
      const back = targetOf("data-footnote-backref");

      expect(back).toBeDefined();
      expect(back).toBe(idOf("data-footnote-ref"));
    });

    it("keeps its ids prefixed once, as a README's own are", () => {
      expect(idOf("data-footnote-ref")).toBe("user-content-fnref-1");
      expect(markup).not.toContain("user-content-user-content-");
    });
  });

  it("prefixes an id the README sets, and points a link to it there", () => {
    const markup = rendered('<a id="top">Top</a>\n\n[up](#top)');

    expect(markup).toContain('id="user-content-top"');
    expect(markup).not.toContain('id="top"');
    expect(anchorsOf(markup)).toContain('<a href="#user-content-top">');
  });

  it("prefixes an anchor's name the README sets, and points a link to it there", () => {
    const markup = rendered('<a name="top">Top</a>\n\n[up](#top)');

    expect(markup).toContain('name="user-content-top"');
    expect(anchorsOf(markup)).toContain('<a href="#user-content-top">');
  });

  it("keeps a link to a heading pointing at the heading", () => {
    const markup = rendered("## Usage\n\n[u](#usage)");

    expect(anchorsOf(markup)).toContain('<a href="#usage">');
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

const proseClasses = () => {
  const markup = rendered(
    "# datekit\n\nCall `format()` first.\n\n```ts\nconst a = () => 1;\n```"
  );

  return new Set(
    /<div class="(?<classes>[^"]*\bprose\b[^"]*)"/u
      .exec(markup)
      ?.groups?.classes?.split(" ")
  );
};

describe("a README drawn in the page's own type", () => {
  it("shows inline code without the backticks around it", () => {
    const classes = proseClasses();

    expect(classes.has("prose-code:before:content-none")).toBeTruthy();
    expect(classes.has("prose-code:after:content-none")).toBeTruthy();
  });

  it("sets a code block on the surface, ruled in a hairline, in the mono size", () => {
    const classes = proseClasses();

    expect(classes.has("prose-pre:bg-surface")).toBeTruthy();
    expect(classes.has("prose-pre:border-rule")).toBeTruthy();
    expect(classes.has("prose-pre:text-mono")).toBeTruthy();
  });

  // `--measure` is 72ch, which design-rules.test.tsx holds against DESIGN.md.
  it("keeps lines to the measure", () => {
    expect(proseClasses().has("max-w-(--measure)")).toBeTruthy();
  });

  // Its `#` is an h2 by then (`rehypeShiftHeadings`), under the page's own h1.
  it("sets its top heading at the title size, under the page's own headline", () => {
    expect(proseClasses().has("prose-h2:text-title")).toBeTruthy();
  });

  it("sizes every element from the type scale, never an arbitrary size", () => {
    expect(
      [...proseClasses()].filter((name) => /(?:^|:)text-\[/u.test(name))
    ).toStrictEqual([]);
  });

  it("colours it from the tokens, so both schemes come from one set of classes", () => {
    const classes = proseClasses();

    expect(classes.has("prose-tokens")).toBeTruthy();
    expect(classes.has("dark:prose-invert")).toBeFalsy();
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
