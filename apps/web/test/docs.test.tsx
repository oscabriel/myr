import { describe, expect, it } from "@effect/vitest";
import { agentEndpoints, agentLimits } from "@repo/agent-kit/agent-setup";
import { commandDocs } from "@repo/agent-kit/command-doc";
import { docPage, docPages } from "@repo/agent-kit/docs/index";
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import { Effect, Option } from "effect";

import { commands } from "../src/features/agents/catalog.ts";
import {
  DocsIndexView,
  DocsPageView,
} from "../src/features/docs/docs-view.tsx";
import { docsHead } from "../src/features/docs/head.ts";
import { AppShell } from "../src/features/shared/shell/app-shell.tsx";
import { docsMarkdownHandler } from "../src/routes/docs/{$page}[.]md.ts";
import { textIn } from "./markup.ts";
import { renderAt } from "./render.tsx";

const input = {
  commands,
  platformUrl: "https://platform-test.example.workers.dev",
  webUrl: "https://web-test.example.workers.dev",
};

const pages = docPages(input);

const textOf = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/gu, " ")
    .trim();

const pageNamed = (slug: string) => Option.getOrThrow(docPage(input, slug));

/** The first element of `tag` carrying the attribute, whole; none of these nest in themselves. */
const elementOf = (markup: string, tag: string, attribute: string) =>
  new RegExp(`<${tag}\\b[^>]*${attribute}[^>]*>[\\s\\S]*?</${tag}>`, "u").exec(
    markup
  )?.[0] ?? "";

const linksOf = (markup: string) =>
  [...markup.matchAll(/<a\b(?<attributes>[^>]*)>(?<text>[\s\S]*?)<\/a>/gu)].map(
    ({ groups }) => {
      const attributes = groups?.attributes ?? "";

      return {
        current: attributes.includes('aria-current="page"'),
        href: /href="(?<href>[^"]*)"/u.exec(attributes)?.groups?.href ?? "",
        text: textOf(groups?.text ?? ""),
      };
    }
  );

/** The article's own `h2`s, as `[id, text]`. */
const headingsOf = (markup: string) =>
  [
    ...elementOf(markup, "article", "data-doc").matchAll(
      /<h2\b[^>]*id="(?<id>[^"]*)"[^>]*>(?<text>[\s\S]*?)<\/h2>/gu
    ),
  ].map(({ groups }) => [groups?.id ?? "", textOf(groups?.text ?? "")]);

/** "On this page": its in-page links, as `[id, text]`. */
const contentsOf = (markup: string) =>
  linksOf(elementOf(markup, "aside", 'aria-label="On this page"')).flatMap(
    ({ href, text }) => (href.startsWith("#") ? [[href.slice(1), text]] : [])
  );

const inDocsShell = (slug: string) =>
  renderAt(
    `/docs/${slug}`,
    <AppShell>
      <DocsPageView page={pageNamed(slug)} />
    </AppShell>
  );

describe("the docs' index", () => {
  it.effect(
    "lists every page under Guides then Reference, each linking its page with its summary",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/docs",
          <DocsIndexView pages={pages} />
        );

        const text = textOf(markup);

        expect(text.indexOf("Guides")).toBeLessThan(text.indexOf("Reference"));

        for (const { slug, summary, title } of pages) {
          expect(markup).toMatch(
            new RegExp(`<a\\b[^>]*href="/docs/${slug}"[^>]*>${title}</a>`, "u")
          );
          expect(text).toContain(summary);
        }
      })
  );
});

describe("a page of the docs in the docs shell", () => {
  it.effect(
    "marks itself current in the tree, and offers its Markdown and its headings beside the article",
    () =>
      Effect.gen(function* () {
        const markup = yield* inDocsShell("landing");
        const aside = elementOf(markup, "aside", 'aria-label="On this page"');

        expect(
          linksOf(elementOf(markup, "nav", 'aria-label="Docs"'))
            .filter(({ current }) => current)
            .map(({ text }) => text)
        ).toStrictEqual(["How a landing happens"]);
        expect(aside).toMatch(
          /<button\b[^>]*>[\s\S]*?Copy as Markdown[\s\S]*?<\/button>/u
        );
        expect(linksOf(aside)).toContainEqual({
          current: false,
          href: "/docs/landing.md",
          text: "View as .md",
        });
        expect(contentsOf(markup)).toStrictEqual(headingsOf(markup));
      })
  );
});

describe("the docs' links to setup", () => {
  it("send a reader to /install, never the old /agents", () => {
    expect(
      pages.flatMap(({ markdown, slug }) =>
        /\]\(\/agents[)#]/u.test(markdown) ? [slug] : []
      )
    ).toStrictEqual([]);
    expect(
      ["connect-an-agent", "mcp"].filter(
        (slug) => !pageNamed(slug).markdown.includes("](/install)")
      )
    ).toStrictEqual([]);
  });
});

describe("a page of the docs", () => {
  it.effect(
    "lists its article's h2s under On this page, in order, each linking its heading's id",
    () =>
      Effect.gen(function* () {
        const mismatched: string[] = [];

        for (const page of pages) {
          const markup = yield* renderAt(
            `/docs/${page.slug}`,
            <DocsPageView page={page} />
          );

          if (
            JSON.stringify(contentsOf(markup)) !==
            JSON.stringify(headingsOf(markup))
          ) {
            mismatched.push(page.slug);
          }
        }

        expect(mismatched).toStrictEqual([]);
        expect(
          contentsOf(
            yield* renderAt(
              "/docs/start-here",
              <DocsPageView page={pageNamed("start-here")} />
            )
          )
        ).toContainEqual([
          "how-a-change-reaches-main",
          "How a change reaches main",
        ]);
      })
  );

  it.effect(
    "draws its Markdown under one title, with the other pages beside it",
    () =>
      Effect.gen(function* () {
        const page = pageNamed("answer-an-ask");

        const markup = yield* renderAt(
          "/docs/answer-an-ask",
          <DocsPageView page={page} />
        );

        expect(markup.match(/<h1\b[^>]*>[^<]*<\/h1>/gu)).toStrictEqual([
          expect.stringMatching(/>Answer an ask<\/h1>$/u),
        ]);
        expect(markup).toMatch(/<h2\b[^>]*id="claim-it"[^>]*>Claim it<\/h2>/u);
        expect(
          [
            'href="/asks"',
            'href="/docs/refusals"',
            'href="/docs/answer-an-ask.md"',
          ].filter((href) => !markup.includes(href))
        ).toStrictEqual([]);
        expect(markup).toMatch(/aria-current="page"[^>]*>Answer an ask</u);
        expect(markup).toMatch(
          /aria-label="Breadcrumb"[\s\S]*?href="\/docs"[^>]*>Docs<[\s\S]*?>Answer an ask</u
        );
      })
  );

  it.effect(
    "lists on Commands every command the CLI has, in its order, each as its synopsis with what it does",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/docs/commands",
          <DocsPageView page={pageNamed("commands")} />
        );

        const rows = [
          ...elementOf(markup, "article", "data-doc").matchAll(
            /<tr>\s*<td\b[^>]*>(?<usage>[\s\S]*?)<\/td>\s*<td\b[^>]*>(?<summary>[\s\S]*?)<\/td>/gu
          ),
        ].map(({ groups }) => ({
          summary: textIn(groups?.summary ?? ""),
          usage: textOf(groups?.usage ?? ""),
        }));

        const expected = commandDocs(Contracts).map(
          ({ flags, path, positional, summary }) => ({
            summary,
            words: [
              Brand.cli,
              ...path,
              ...positional.map((name) => `<${name}>`),
              ...flags
                .filter((flag) => !positional.includes(flag.slice(2)))
                .map((flag) => `[${flag}]`),
            ],
          })
        );

        expect(rows.map(({ usage }) => usage.split(" "))).toStrictEqual(
          expected.map(({ words }) => words)
        );
        expect(rows.map(({ summary }) => summary)).toStrictEqual(
          expected.map(({ summary }) => summary.replaceAll("`", ""))
        );
      })
  );

  it.effect("draws a reference page's tables", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt(
        "/docs/refusals",
        <DocsPageView page={pageNamed("refusals")} />
      );

      expect(markup).toContain("<table");
      expect(markup).toContain("<code>OutOfScope</code>");
    })
  );

  it.effect(
    "draws every limit and endpoint agent-kit gives on the Limits and endpoints page, each endpoint a reader can open as a link",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/docs/limits",
          <DocsPageView page={pageNamed("limits")} />
        );

        const text = textOf(markup);

        expect(markup.match(/<table/gu)).toHaveLength(2);
        expect(
          [
            ...agentLimits().flatMap(({ limit, value }) => [limit, value]),
            ...agentEndpoints(input).flatMap(({ url, what }) => [url, what]),
          ].filter((words) => !text.includes(words))
        ).toStrictEqual([]);
        expect(
          agentEndpoints(input)
            .filter(
              ({ readable, url }) =>
                markup.includes(`href="${url}"`) !== readable
            )
            .map(({ url }) => url)
        ).toStrictEqual([]);
      })
  );

  it("names its Markdown in its head, with its summary as its description", () => {
    const head = docsHead(pageNamed("events"));

    expect(head.links).toContainEqual({
      href: "/docs/events.md",
      rel: "alternate",
      type: "text/markdown",
    });
    expect(head.meta).toContainEqual({
      content: pageNamed("events").summary,
      name: "description",
    });
  });
});

const served = (page: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      docsMarkdownHandler(input.platformUrl)({
        params: { page },
        request: new Request(`${input.webUrl}/docs/${page}.md`),
      })
    );

    return {
      body: yield* Effect.promise(() => response.text()),
      contentType: response.headers.get("content-type"),
      status: response.status,
    };
  });

describe("a page of the docs as Markdown", () => {
  it.effect("is the page's text", () =>
    Effect.gen(function* () {
      expect(yield* served("commands")).toStrictEqual({
        body: pageNamed("commands").markdown,
        contentType: "text/markdown; charset=utf-8",
        status: 200,
      });
    })
  );

  it.effect("is a 404 for a page that does not exist", () =>
    Effect.gen(function* () {
      expect((yield* served("nope")).status).toBe(404);
    })
  );
});
