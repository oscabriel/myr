import { describe, expect, it } from "@effect/vitest";
import { docPage, docPages } from "@repo/agent-kit/docs/index";
import { Effect, Option } from "effect";

import { commands } from "../src/features/agents/catalog.ts";
import {
  DocsIndexView,
  DocsPageView,
} from "../src/features/docs/docs-view.tsx";
import { docsHead } from "../src/features/docs/head.ts";
import { docsMarkdownHandler } from "../src/routes/docs/{$page}[.]md.ts";
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
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/gu, " ")
    .trim();

const pageNamed = (slug: string) => Option.getOrThrow(docPage(input, slug));

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

describe("a page of the docs", () => {
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
