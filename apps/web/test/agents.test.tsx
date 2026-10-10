/**
 * The Agents page: how each agent connects, drawn from `@repo/agent-kit`'s
 * `agentSetup`, so the page has no text of its own for a snippet
 * (principle 4); `/agents.md` is the same channels as Markdown.
 */
import { describe, expect, it } from "@effect/vitest";
import { agentSetup, agentSetupMarkdown } from "@repo/agent-kit/agent-setup";
import { Effect } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { commands } from "../src/features/agents/catalog.ts";
import { AgentSetupView } from "../src/features/agents/setup-page.tsx";
import { agentsMarkdownHandler } from "../src/routes/agents[.]md.ts";

const platformUrl = "https://platform-test.example.workers.dev";

const webUrl = "https://web-test.example.workers.dev";

const channels = agentSetup({ commands, platformUrl, webUrl });

/** The entities React writes for text, and what each reads as. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

const decoded = (html: string) =>
  html.replaceAll(
    /&(?:#x27|amp|gt|lt|quot);/gu,
    (entity) => ENTITIES.get(entity) ?? entity
  );

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (element: ReactElement) =>
  decoded(markupOf(element).replaceAll(/<[^>]+>/gu, ""));

/** The text of every `<code>` on the page, in order. */
const codeOf = (element: ReactElement) =>
  [...markupOf(element).matchAll(/<code\b[^>]*>(?<body>.*?)<\/code>/gsu)].map(
    ({ groups }) => decoded(groups?.body ?? "")
  );

describe("the Agents page", () => {
  const page = <AgentSetupView channels={channels} />;

  it("shows every snippet agentSetup gives, and no code of its own", () => {
    expect(codeOf(page)).toStrictEqual(
      channels.flatMap(({ snippets }) => snippets.map(({ text }) => text))
    );
  });

  it("heads each channel with its title and says when to use it", () => {
    const text = textOf(page);

    for (const { snippets, title, useWhen } of channels) {
      expect(text).toContain(title);
      expect(text).toContain(useWhen);

      for (const { label } of snippets) {
        expect(text).toContain(label);
      }
    }
  });

  it("gives every snippet a button that copies it", () => {
    const buttons = markupOf(page).match(
      /<button\b[^>]*>.*?Copy.*?<\/button>/gu
    );

    expect(buttons).toHaveLength(
      channels.reduce((count, { snippets }) => count + snippets.length, 0)
    );
  });

  it("links the same channels as Markdown", () => {
    expect(markupOf(page)).toMatch(/<a\b[^>]*href="\/agents\.md"[^>]*>/u);
  });
});

describe("/agents.md", () => {
  it.effect("answers the channels as Markdown for the web's own origin", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        agentsMarkdownHandler(platformUrl)({
          request: new Request(`${webUrl}/agents.md`),
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/markdown; charset=utf-8"
      );
      expect(yield* Effect.promise(() => response.text())).toBe(
        agentSetupMarkdown({ commands, platformUrl, webUrl })
      );
    })
  );
});
