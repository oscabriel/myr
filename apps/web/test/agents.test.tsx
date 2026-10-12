import { describe, expect, it } from "@effect/vitest";
import {
  agentEndpoints,
  agentLimits,
  agentSetup,
  agentSetupMarkdown,
} from "@repo/agent-kit/agent-setup";
import { Brand } from "@repo/brand";
import { groups } from "@repo/protocol/refusal";
import { Effect } from "effect";

import { commands } from "../src/features/agents/catalog.ts";
import { AgentsView } from "../src/features/agents/setup-page.tsx";
import { agentsMarkdownHandler } from "../src/routes/agents[.]md.ts";
import { renderAt } from "./render.tsx";

const platformUrl = "https://platform-test.example.workers.dev";

const webUrl = "https://web-test.example.workers.dev";

const channels = agentSetup({ commands, platformUrl, webUrl });

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

const textOf = (html: string) => decoded(html.replaceAll(/<[^>]+>/gu, ""));

const codeOf = (html: string) =>
  [...html.matchAll(/<code\b[^>]*>(?<body>.*?)<\/code>/gsu)].map(
    ({ groups: found }) => textOf(found?.body ?? "")
  );

const page = renderAt(
  "/agents",
  <AgentsView commands={commands} platformUrl={platformUrl} webUrl={webUrl} />
);

const sectionOf = (html: string, id: string) => {
  const start = html.indexOf(`<section aria-labelledby="${id}"`);
  const end = html.indexOf("</section>", start);

  expect(start).toBeGreaterThanOrEqual(0);

  return html.slice(start, end);
};

const SECTIONS = [
  ["synopsis", "Synopsis"],
  ["connect", "Connect"],
  ["endpoints", "Endpoints"],
  ["limits", "Limits"],
  ["refusals", "Refusals"],
] as const;

describe("the For agents page", () => {
  it.effect("is titled For agents", () =>
    Effect.gen(function* () {
      expect(yield* page).toMatch(/<h1\b[^>]*>For agents<\/h1>/u);
    })
  );

  it.effect(
    "has its five sections in order, headed in the sans in sentence case",
    () =>
      Effect.gen(function* () {
        const html = yield* page;

        const headings = [
          ...html.matchAll(
            /<h2 (?<attributes>[^>]*)id="(?<id>[a-z]+)"[^>]*>(?<text>[^<]*)<\/h2>/gu
          ),
        ];

        expect(
          headings.map(({ groups: found }) => [found?.id, found?.text])
        ).toStrictEqual(SECTIONS.map(([id, title]) => [id, title]));

        for (const { groups: found } of headings) {
          expect(found?.attributes).not.toContain("font-mono");
          expect(found?.attributes).not.toContain("uppercase");
        }

        for (const { groups: found } of html.matchAll(
          /<h(?<level>[1-4])\b[^>]*>(?<text>.*?)<\/h\k<level>>/gu
        )) {
          const words = textOf(found?.text ?? "");

          expect(
            words === words.toUpperCase() && /[A-Z]/u.test(words)
          ).toBeFalsy();
        }
      })
  );

  it.effect("lists the five sections, as anchors, in its contents", () =>
    Effect.gen(function* () {
      const html = yield* page;
      const inspector = html.slice(html.indexOf('data-facts="inspector"'));

      const anchors = [
        ...inspector.matchAll(/<a\b[^>]*href="#(?<id>[a-z]+)"/gu),
      ].map(({ groups: found }) => found?.id);

      expect(anchors).toStrictEqual(SECTIONS.map(([id]) => id));
    })
  );

  it.effect(
    "lands each anchor's heading below the sticky bars, not under them",
    () =>
      Effect.gen(function* () {
        const html = yield* page;

        for (const [id] of SECTIONS) {
          // The element the fragment scrolls to is the one with the id: its
          // own scroll margin is the one the browser reads.
          const target = new RegExp(
            `<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`,
            "u"
          )
            .exec(html)
            ?.at(0);

          expect(target, `#${id}`).toMatch(/\bscroll-mt-\d+\b/u);
        }
      })
  );

  it.effect("gives every command of the CLI a synopsis line, in mono", () =>
    Effect.gen(function* () {
      const synopsis = codeOf(sectionOf(yield* page, "synopsis"));

      expect(synopsis).toHaveLength(commands.length);

      for (const [index, command] of commands.entries()) {
        expect(
          synopsis[index]?.startsWith(`${Brand.cli} ${command.path.join(" ")}`)
        ).toBeTruthy();
      }
    })
  );

  it.effect(
    "shows every snippet agentSetup gives under Connect, and no code of its own",
    () =>
      Effect.gen(function* () {
        const connect = sectionOf(yield* page, "connect");

        expect(codeOf(connect)).toStrictEqual(
          channels.flatMap(({ snippets }) => snippets.map(({ text }) => text))
        );

        const text = textOf(connect);

        for (const { snippets, title, useWhen } of channels) {
          expect(text).toContain(title);
          expect(text).toContain(useWhen);

          for (const { label } of snippets) {
            expect(text).toContain(label);
          }
        }
      })
  );

  it.effect("gives every snippet a button that copies it", () =>
    Effect.gen(function* () {
      const buttons = sectionOf(yield* page, "connect").match(
        /<button\b[^>]*>.*?Copy.*?<\/button>/gu
      );

      expect(buttons).toHaveLength(
        channels.reduce((count, { snippets }) => count + snippets.length, 0)
      );
    })
  );

  it.effect("names every endpoint and limit agent-kit gives", () =>
    Effect.gen(function* () {
      const html = yield* page;
      const endpoints = sectionOf(html, "endpoints");

      expect(codeOf(endpoints)).toStrictEqual(
        agentEndpoints({ platformUrl, webUrl }).map(({ url }) => url)
      );

      for (const { readable, url, what } of agentEndpoints({
        platformUrl,
        webUrl,
      })) {
        expect(textOf(endpoints)).toContain(what);
        expect(endpoints.includes(`href="${url}"`)).toBe(readable);
      }

      const limits = textOf(sectionOf(html, "limits"));

      for (const { limit, value } of agentLimits()) {
        expect(limits).toContain(limit);
        expect(limits).toContain(value);
      }
    })
  );

  it.effect(
    "names every refusal of the union, each linked to its row in /llms-full.txt",
    () =>
      Effect.gen(function* () {
        const refusals = sectionOf(yield* page, "refusals");

        const tags = groups.flatMap(({ members }) =>
          members.map(({ identifier }) => identifier)
        );

        expect(codeOf(refusals)).toStrictEqual(tags);

        for (const { members, name } of groups) {
          expect(textOf(refusals)).toContain(name);

          for (const { identifier } of members) {
            expect(refusals).toMatch(
              new RegExp(
                `<a\\b[^>]*href="/llms-full\\.txt#:~:text=%60${identifier}%60[^"]*"[^>]*><code\\b[^>]*>${identifier}</code>`,
                "u"
              )
            );
          }
        }
      })
  );

  it.effect("links the same reference as Markdown", () =>
    Effect.gen(function* () {
      expect(yield* page).toMatch(/<a\b[^>]*href="\/agents\.md"[^>]*>/u);
    })
  );
});

describe("/agents.md", () => {
  it.effect("answers the reference as Markdown for the web's own origin", () =>
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
