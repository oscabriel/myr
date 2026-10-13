// The setup page moved from `/agents` to `/install` (ADR 0041); its guarantee moved with it: every snippet and command
// on the page is `@repo/agent-kit`'s.
import { describe, expect, it } from "@effect/vitest";
import { agentSetupMarkdown } from "@repo/agent-kit/agent-setup";
import { installChannels } from "@repo/agent-kit/install-channels";
import { isRedirect } from "@tanstack/react-router";
import { Effect, Option } from "effect";

import { commands } from "../src/features/agents/catalog.ts";
import { InstallView } from "../src/features/agents/install-page.tsx";
import { getRouter } from "../src/router.tsx";
import { agentsLoader } from "../src/routes/agents.tsx";
import { agentsMarkdownHandler } from "../src/routes/agents[.]md.ts";
import { Route as InstallRoute } from "../src/routes/install.tsx";
import { renderAt } from "./render.tsx";

const platformUrl = "https://platform-test.example.workers.dev";

const webUrl = "https://web-test.example.workers.dev";

const channels = installChannels({ commands, platformUrl, webUrl });

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
  "/install",
  <InstallView commands={commands} platformUrl={platformUrl} webUrl={webUrl} />
);

const sectionOf = (html: string, id: string) => {
  const start = html.indexOf(`<section aria-labelledby="${id}"`);
  const end = html.indexOf("</section>", start);

  expect(start, `#${id}`).toBeGreaterThanOrEqual(0);

  return html.slice(start, end);
};

const channelNamed = (id: string) =>
  Option.getOrThrow(
    Option.fromNullishOr(channels.find((each) => each.id === id))
  );

const snippetCount = channels.reduce(
  (count, { snippets }) => count + snippets.length,
  0
);

describe("the Install page", () => {
  it.effect("is titled Install, every heading in sentence case", () =>
    Effect.gen(function* () {
      const html = yield* page;

      expect(html).toMatch(/<h1\b[^>]*>Install<\/h1>/u);

      for (const { groups: found } of html.matchAll(
        /<h(?<level>[1-4])\b(?<attributes>[^>]*)>(?<text>.*?)<\/h\k<level>>/gu
      )) {
        const words = textOf(found?.text ?? "");

        expect(found?.attributes).not.toContain("uppercase");
        expect(
          words === words.toUpperCase() && /[A-Z]/u.test(words)
        ).toBeFalsy();
      }
    })
  );

  it.effect(
    "gives every channel agent-kit names its own section, in order, headed by its title below the sticky bar",
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
        ).toStrictEqual(channels.map(({ id, title }) => [id, title]));

        for (const { groups: found } of headings) {
          expect(found?.attributes, `#${found?.id}`).toMatch(
            /\bscroll-mt-\d+\b/u
          );
        }

        for (const { id } of channels) {
          sectionOf(html, id);
        }
      })
  );

  it.effect("shows every snippet agent-kit gives, and no code of its own", () =>
    Effect.gen(function* () {
      const html = yield* page;

      expect(codeOf(html)).toStrictEqual(
        channels.flatMap(({ snippets }) => snippets.map(({ text }) => text))
      );

      const text = textOf(html);

      for (const { audience, snippets, summary, title } of channels) {
        expect(
          [
            audience,
            summary,
            title,
            ...snippets.map(({ label }) => label),
          ].filter((words) => !text.includes(words))
        ).toStrictEqual([]);
      }
    })
  );

  it.effect("gives every snippet a button that copies it", () =>
    Effect.gen(function* () {
      expect(
        (yield* page).match(
          /<button\b[^>]*>(?:(?!<\/button>).)*Copy(?:(?!<\/button>).)*<\/button>/gu
        )
      ).toHaveLength(snippetCount);
    })
  );

  it.effect(
    "shows MCP's clients and stdio as tabs, each with its snippet in a panel",
    () =>
      Effect.gen(function* () {
        const mcp = sectionOf(yield* page, "mcp");
        const names = channelNamed("mcp").snippets.map(({ name }) => name);

        expect(mcp).toContain('role="tablist"');
        expect(
          [
            ...mcp.matchAll(
              /<button\b[^>]*role="tab"[^>]*>(?<name>.*?)<\/button>/gu
            ),
          ].map(({ groups: found }) => textOf(found?.name ?? ""))
        ).toStrictEqual(names);
        expect(mcp.match(/role="tabpanel"/gu)).toHaveLength(names.length);
      })
  );

  it.effect(
    "shows the pi extension as planned, with no command, and git over HTTPS with no SSH key",
    () =>
      Effect.gen(function* () {
        const html = yield* page;
        const pi = sectionOf(html, "pi");

        expect(textOf(pi)).toContain("Planned");
        expect(codeOf(pi)).toStrictEqual([]);
        expect(textOf(sectionOf(html, "git"))).toContain("HTTPS");
        expect(
          textOf(html)
            .replaceAll("no SSH keys", "")
            .match(/ssh|git@/giu)
        ).toBeNull();
      })
  );

  it.effect(
    "links each channel's references, the commands at the docs, and signing in on the web",
    () =>
      Effect.gen(function* () {
        const html = yield* page;

        expect(
          channels
            .flatMap(({ id, links }) => links.map(({ path }) => ({ id, path })))
            .filter(
              ({ id, path }) => !sectionOf(html, id).includes(`href="${path}"`)
            )
        ).toStrictEqual([]);
        expect(sectionOf(html, "cli")).toContain('href="/docs/commands"');
        expect(sectionOf(html, "web")).toContain('href="/auth/signin"');
      })
  );
});

describe("the old /agents", () => {
  it.effect("answers a 301 to /install", () =>
    Effect.gen(function* () {
      const answered = yield* Effect.flip(
        Effect.tryPromise({
          catch: (thrown): readonly [number, string | null] =>
            isRedirect(thrown)
              ? [thrown.status, thrown.headers.get("location")]
              : [0, null],
          try: agentsLoader,
        })
      );

      expect(answered).toStrictEqual([301, "/install"]);
    })
  );

  it("leaves /install to the Install page", () => {
    expect(getRouter().getMatchedRoutes("/install")[2]).toBe(InstallRoute);
  });
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
