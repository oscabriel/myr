/**
 * The shell every page sits in, rendered to HTML inside a router at an
 * address (`render.tsx`): the rail's sections and the project's, main with
 * its context bar, the inspector when the page has facts, the phone's
 * bottom bar, and a skip link. Its links are the router's, so a click moves
 * without reloading the document.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import { PageShell } from "../src/features/shared/layout.tsx";
import { AppLink } from "../src/features/shared/link.tsx";
import { RouteError } from "../src/features/shared/pending.tsx";
import { AppShell } from "../src/features/shared/shell/app-shell.tsx";
import { RailSlot } from "../src/features/shared/shell/rail-slot.tsx";
import { Workspace } from "../src/features/shared/shell/workspace.tsx";
import { renderAt } from "./render.tsx";

/** The element `tag` whose opening tag carries `attribute`, whole (no nested `tag`). */
const elementOf = (markup: string, tag: string, attribute: string) =>
  new RegExp(`<${tag}\\b[^>]*${attribute}[^>]*>[\\s\\S]*?</${tag}>`, "u").exec(
    markup
  )?.[0] ?? "";

/** Each link in `markup`: its text, href, and the router's marks on it. */
const linksOf = (markup: string) =>
  [...markup.matchAll(/<a\b(?<attributes>[^>]*)>(?<text>[\s\S]*?)<\/a>/gu)].map(
    ({ groups }) => {
      const attributes = groups?.attributes ?? "";

      return {
        active: /data-status="active"/u.test(attributes),
        current: /aria-current="page"/u.exec(attributes) !== null,
        href: /href="(?<href>[^"]*)"/u.exec(attributes)?.groups?.href,
        text: (groups?.text ?? "")
          .replaceAll(/<[^>]+>/gu, " ")
          .replaceAll(/\s+/gu, " ")
          .trim(),
      };
    }
  );

/** What a reader sees of `markup`, tags gone and spaces folded. */
const textOf = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

const ledgerPage = (facts: boolean) => (
  <AppShell>
    <Workspace
      crumbs={[{ label: "datekit", to: "/datekit" }, { label: "Ledger" }]}
      title="Ledger"
      {...(facts
        ? { facts: <p>Posture: open</p>, factsHeading: "This ledger" }
        : {})}
    >
      <p>Entries</p>
    </Workspace>
  </AppShell>
);

/** What a code page puts in the rail's slot. */
const Tree = () => (
  <RailSlot>
    <p>src/add.ts</p>
  </RailSlot>
);

describe("the shell", () => {
  it.effect(
    "names the site's sections in the rail, each a word, and the project's under it with the page being read current",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt("/datekit/ledger", ledgerPage(true));
        const rail = elementOf(markup, "nav", 'aria-label="Site"');
        const links = linksOf(rail);

        expect(rail).not.toBe("");
        expect(
          links.filter(({ href }) =>
            ["/home", "/asks", "/today", "/docs", "/agents"].includes(
              href ?? ""
            )
          )
        ).toStrictEqual([
          { active: false, current: false, href: "/home", text: "Home" },
          { active: false, current: false, href: "/asks", text: "Asks" },
          { active: false, current: false, href: "/today", text: "Today" },
          { active: false, current: false, href: "/docs", text: "Docs" },
          {
            active: false,
            current: false,
            href: "/agents",
            text: "For agents",
          },
        ]);
        expect(
          links
            .filter(
              ({ href }) =>
                href?.startsWith("/datekit/") === true || href === "/datekit"
            )
            .map(({ href, text, current }) => ({ current, href, text }))
            .filter(({ text }) => text !== "datekit")
        ).toStrictEqual([
          { current: false, href: "/datekit", text: "Asks" },
          { current: false, href: "/datekit/tree/main", text: "Code" },
          { current: false, href: "/datekit/commits/main", text: "Landings" },
          { current: false, href: "/datekit/refs", text: "Refs" },
          { current: false, href: "/datekit/people", text: "Policy" },
          { current: true, href: "/datekit/ledger", text: "Ledger" },
          { current: false, href: "/datekit/env", text: "Env shape" },
        ]);
      })
  );

  it.effect(
    "names the current project in the rail at once, before the list of projects has arrived",
    () =>
      Effect.gen(function* () {
        const rail = elementOf(
          yield* renderAt("/datekit/ledger", ledgerPage(false)),
          "nav",
          'aria-label="Site"'
        );

        expect(textOf(rail)).toContain("Projects");
        expect(linksOf(rail).map(({ text }) => text)).toContain("datekit");
      })
  );

  it.effect(
    "draws every link in the rail with the router's link, which marks the page it leads to",
    () =>
      Effect.gen(function* () {
        const agents = linksOf(
          elementOf(
            yield* renderAt("/agents", ledgerPage(false)),
            "nav",
            'aria-label="Site"'
          )
        );

        const ledger = linksOf(
          elementOf(
            yield* renderAt("/datekit/ledger", ledgerPage(false)),
            "nav",
            'aria-label="Site"'
          )
        );

        expect(agents.filter(({ active }) => active)).toStrictEqual([
          { active: true, current: true, href: "/agents", text: "For agents" },
        ]);
        expect(ledger.filter(({ active }) => active)).toStrictEqual([
          {
            active: true,
            current: true,
            href: "/datekit/ledger",
            text: "Ledger",
          },
        ]);
      })
  );

  it.effect(
    "draws only the page on the landing, with no rail, bars or skip link, and the wordmark leads there",
    () =>
      Effect.gen(function* () {
        const landing = yield* renderAt(
          "/",
          <AppShell>
            <p>Landing</p>
          </AppShell>
        );

        expect(landing).toBe("<p>Landing</p>");

        const rail = elementOf(
          yield* renderAt("/agents", ledgerPage(false)),
          "nav",
          'aria-label="Site"'
        );

        expect(linksOf(rail)[0]).toMatchObject({ href: "/", text: Brand.name });
      })
  );

  it.effect("shows no project's sections on a page outside a project", () =>
    Effect.gen(function* () {
      const rail = elementOf(
        yield* renderAt("/agents", ledgerPage(false)),
        "nav",
        'aria-label="Site"'
      );

      expect(linksOf(rail).map(({ href }) => href)).not.toContain(
        "/datekit/ledger"
      );
    })
  );

  it.effect(
    "gives the page one main region, its context bar naming the project and the page",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt("/datekit/ledger", ledgerPage(true));
        const main = elementOf(markup, "main", 'id="main"');
        const crumbs = elementOf(main, "nav", 'aria-label="Breadcrumb"');

        expect(main).toContain("<p>Entries</p>");
        expect(textOf(crumbs)).toBe("datekit / Ledger");
        expect(linksOf(crumbs)).toStrictEqual([
          { active: false, current: false, href: "/datekit", text: "datekit" },
        ]);
        expect(main).toMatch(/<h1\b[^>]*>Ledger<\/h1>/u);
      })
  );

  it.effect(
    "names the page's project from the address when the page gives no crumbs of its own",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/datekit/env",
          <AppShell>
            <PageShell title="Env shape of datekit">
              <p>Items</p>
            </PageShell>
          </AppShell>
        );

        expect(
          textOf(elementOf(markup, "nav", 'aria-label="Breadcrumb"'))
        ).toBe("datekit / Env shape");
      })
  );

  it.effect(
    "gives the facts an inspector named Facts when the page has some, and none when it has none",
    () =>
      Effect.gen(function* () {
        const withFacts = yield* renderAt("/datekit/ledger", ledgerPage(true));
        const without = yield* renderAt("/datekit/ledger", ledgerPage(false));

        expect(elementOf(withFacts, "aside", 'aria-label="Facts"')).toContain(
          "Posture: open"
        );
        expect(elementOf(withFacts, "aside", 'aria-label="Facts"')).toContain(
          "This ledger"
        );
        expect(without).not.toContain("<aside");
      })
  );

  it.effect(
    "gives phones a bar of sections: Home, Asks, Today, Projects and More",
    () =>
      Effect.gen(function* () {
        const bar = elementOf(
          yield* renderAt("/datekit/ledger", ledgerPage(false)),
          "nav",
          'aria-label="Sections"'
        );

        expect(textOf(bar)).toBe("Home Asks Today Projects More");
        expect(linksOf(bar).map(({ href }) => href)).toStrictEqual([
          "/home",
          "/asks",
          "/today",
        ]);
      })
  );

  it.effect("lets a keyboard skip to the page's content", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt("/today", ledgerPage(false));

      expect(markup).toMatch(
        /<a\b[^>]*href="#main"[^>]*>Skip to content<\/a>/u
      );
      expect(markup).toContain(Brand.name);
    })
  );

  it.effect(
    "keeps the rail's slot for a page that fills it, and none for a page that does not",
    () =>
      Effect.gen(function* () {
        const code = yield* renderAt("/datekit/tree/main", ledgerPage(false), {
          rail: Tree,
        });

        const ledger = yield* renderAt("/datekit/ledger", ledgerPage(false));

        expect(elementOf(code, "nav", 'aria-label="Site"')).toContain(
          "<p>src/add.ts</p>"
        );
        expect(ledger).not.toContain("src/add.ts");
      })
  );
});

describe("the shell's controls", () => {
  // A colour given to a kit button must not cost it the UI size: the
  // class merger reads an unknown `text-*` as a colour, so a colour class
  // drops `text-ui` and the button falls back to the body's 16 px.
  it.effect("set every button in the rail at the UI size", () =>
    Effect.gen(function* () {
      const rail = elementOf(
        yield* renderAt("/datekit/tree/main", ledgerPage(false), {
          rail: Tree,
        }),
        "nav",
        'aria-label="Site"'
      );

      const buttons = [
        ...rail.matchAll(/<button\b[^>]*class="(?<classes>[^"]*)"/gu),
      ].map(({ groups }) => groups?.classes?.split(" ") ?? []);

      expect(buttons.length).toBeGreaterThanOrEqual(2);
      expect(
        buttons.filter((classes) => !classes.includes("text-ui"))
      ).toStrictEqual([]);
    })
  );
});

describe(AppLink, () => {
  // A path is built whole, and a file's path may hold the router's own
  // marks (`routes/$project/route.tsx`, `{-$x}`): they are the file's
  // name, never a param to fill from the page being read.
  it.effect("leads to a path holding $ or braces as written", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt(
        "/datekit/ledger",
        <p>
          <AppLink to="/datekit/blob/main/src/routes/$project/$.tsx">
            route
          </AppLink>
          <AppLink to="/datekit/blob/main/src/{-$x}.ts">optional</AppLink>
        </p>
      );

      const hrefs = linksOf(markup).map(({ href }) => href);

      expect(hrefs.map((href) => decodeURIComponent(href ?? ""))).toStrictEqual(
        [
          "/datekit/blob/main/src/routes/$project/$.tsx",
          "/datekit/blob/main/src/{-$x}.ts",
        ]
      );
    })
  );

  it("draws the same address with no router around it", () => {
    expect(
      renderToStaticMarkup(
        <AppLink to="/datekit/blob/main/src/routes/$project/$.tsx">
          route
        </AppLink>
      )
    ).toMatch(
      /href="\/datekit\/blob\/main\/src\/routes\/(?:\$|%24)project\/(?:\$|%24)\.tsx"/u
    );
  });
});

describe("the shell's sources", () => {
  // Keys only: the sources as text.
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/shared/shell/*.tsx",
    { eager: true, import: "default", query: "?raw" }
  );

  it("draw no plain anchor: every link is the router's, so a click never reloads the document", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(3);
    expect(
      Object.entries(sources).flatMap(([file, source]) =>
        /<a\b/u.test(source) ? [file] : []
      )
    ).toStrictEqual([]);
  });
});

describe(PageShell, () => {
  it.effect("gives a page one main region headed by its title", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt(
        "/today",
        <PageShell title="Today">
          <p>Decisions 2 of 5</p>
        </PageShell>
      );

      expect(elementOf(markup, "main", 'id="main"')).toMatch(
        /<h1\b[^>]*>Today<\/h1>[\s\S]*<p>Decisions 2 of 5<\/p>/u
      );
    })
  );
});

describe("a page whose read fails", () => {
  // A transport failure is not a refusal: ink and a way to ask again,
  // inside the shell, never the router's own error page.
  it.effect("says the platform did not answer, in ink, inside the shell", () =>
    Effect.gen(function* () {
      const root = createRootRoute({
        component: () => (
          <AppShell>
            <Outlet />
          </AppShell>
        ),
      });

      const failing = createRoute({
        getParentRoute: () => root,
        loader: () => Promise.reject(new Error("fetch failed")),
        path: "$project",
      });

      const router = createRouter({
        defaultErrorComponent: RouteError,
        history: createMemoryHistory({ initialEntries: ["/datekit"] }),
        routeTree: root.addChildren([failing]),
      });

      yield* Effect.tryPromise(() => router.load());

      const markup = renderToStaticMarkup(<RouterProvider router={router} />);
      const main = elementOf(markup, "main", 'id="main"');

      expect(textOf(main)).toContain("The platform did not answer.");
      expect(textOf(main)).toContain(
        "Try again in a minute; nothing was changed."
      );
      expect(main).toMatch(/<button\b[^>]*>Reload<\/button>/u);
      expect(main).not.toContain("refused");
      expect(markup).toContain('aria-label="Site"');
    })
  );
});
