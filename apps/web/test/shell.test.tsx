import { describe, expect, it } from "@effect/vitest";
import { docEntries } from "@repo/agent-kit/docs/entries";
import { Brand } from "@repo/brand";
import { ProjectName } from "@repo/protocol/ids";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import type { StaticDataRouteOption } from "@tanstack/react-router";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useKeys } from "../src/features/shared/keys.tsx";
import { PageShell } from "../src/features/shared/layout.tsx";
import { AppLink } from "../src/features/shared/link.tsx";
import { projectPath } from "../src/features/shared/paths.ts";
import { RouteError } from "../src/features/shared/pending.tsx";
import { AppShell } from "../src/features/shared/shell/app-shell.tsx";
import {
  MenuBody,
  ProjectsSheetBody,
} from "../src/features/shared/shell/overlays.tsx";
import { SITE_LINKS } from "../src/features/shared/shell/top-bar.tsx";
import { Workspace } from "../src/features/shared/shell/workspace.tsx";
import { Route as projectRoute } from "../src/routes/$owner/$project/route.tsx";
import { Route as docsRoute } from "../src/routes/docs/$page.tsx";
import { Route as importRoute } from "../src/routes/import.tsx";
import { Route as landingRoute } from "../src/routes/index.tsx";
import { TEN_LISTED } from "./listings.ts";
import { renderAt } from "./render.tsx";

const elementOf = (markup: string, tag: string, attribute: string) =>
  new RegExp(`<${tag}\\b[^>]*${attribute}[^>]*>[\\s\\S]*?</${tag}>`, "u").exec(
    markup
  )?.[0] ?? "";

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

const textOf = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

/** The opening tag of the first element carrying the attribute. */
const tagWith = (markup: string, attribute: string) =>
  new RegExp(`<[a-z]+\\b[^>]*${attribute}[^>]*>`, "u").exec(markup)?.[0] ?? "";

const shellOf = (staticData: StaticDataRouteOption | undefined) =>
  staticData?.shell;

const staticOf = (route: {
  readonly options: { readonly staticData?: StaticDataRouteOption };
}): StaticDataRouteOption => route.options.staticData ?? {};

/**
 * One route per shell, each carrying the `staticData` its real route
 * declares, so the frame drawn is the one the route names.
 */
const shellRoutes = (view: ReactNode) => {
  const root = createRootRoute({
    component: () => (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
  });

  const page = () => view;

  return root.addChildren([
    createRoute({
      component: page,
      getParentRoute: () => root,
      path: "/",
      staticData: staticOf(landingRoute),
    }),
    createRoute({
      component: page,
      getParentRoute: () => root,
      path: "$owner/$project",
      staticData: staticOf(projectRoute),
    }),
    createRoute({
      component: page,
      getParentRoute: () => root,
      path: "docs/$page",
      staticData: staticOf(docsRoute),
    }),
    createRoute({
      component: page,
      getParentRoute: () => root,
      path: "import",
      staticData: staticOf(importRoute),
    }),
  ]);
};

const inShell = (
  url: string,
  view: ReactNode = (
    <PageShell title="Page">
      <p>Body</p>
    </PageShell>
  )
) =>
  Effect.gen(function* () {
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: [url] }),
      routeTree: shellRoutes(view),
    });

    yield* Effect.tryPromise(() => router.load());

    return renderToStaticMarkup(<RouterProvider router={router} />);
  });

const SITE = "/";

const PROJECT = "/oscabriel/datekit";

const DOCS = "/docs/answer-an-ask";

const FOCUS = "/import";

const topBarOf = (markup: string) =>
  elementOf(markup, "header", "data-top-bar");

const KeysProbe = () => (
  <p data-keys={useKeys() === undefined ? "missing" : "provided"}>Keys</p>
);

describe("the four shells", () => {
  it("are what the real routes name", () => {
    expect(
      [landingRoute, projectRoute, docsRoute, importRoute].map(({ options }) =>
        shellOf(options.staticData)
      )
    ).toStrictEqual(["site", "project", "docs", "focus"]);
  });

  it.effect(
    "draw the site with the framed top bar and the footer, and no side column",
    () =>
      Effect.gen(function* () {
        const markup = yield* inShell(SITE);

        expect(tagWith(markup, "data-shell=")).toContain('data-shell="site"');
        expect(tagWith(markup, "data-top-bar")).toContain(
          'data-top-bar="framed"'
        );
        expect(elementOf(markup, "footer", "data-footer")).not.toBe("");
        expect(markup).not.toContain("<aside");
        expect(markup).not.toContain("data-column");
      })
  );

  it.effect("draw a project with the full-bleed top bar and no footer", () =>
    Effect.gen(function* () {
      const markup = yield* inShell(PROJECT);

      expect(tagWith(markup, "data-shell=")).toContain('data-shell="project"');
      expect(tagWith(markup, "data-top-bar")).toContain(
        'data-top-bar="full-bleed"'
      );
      expect(markup).not.toContain("<footer");
    })
  );

  it.effect(
    "draw the docs with a nav tree of every page, the page being read current, and the footer",
    () =>
      Effect.gen(function* () {
        const markup = yield* inShell(DOCS);
        const tree = linksOf(elementOf(markup, "nav", 'aria-label="Docs"'));

        expect(tagWith(markup, "data-shell=")).toContain('data-shell="docs"');
        expect(tree.map(({ href }) => href)).toStrictEqual(
          docEntries.map(({ slug }) => `/docs/${slug}`)
        );
        expect(
          tree.filter(({ current }) => current).map(({ text }) => text)
        ).toStrictEqual(["Answer an ask"]);
        expect(elementOf(markup, "footer", "data-footer")).not.toBe("");
      })
  );

  it.effect(
    "draw a focused page with the wordmark alone and no navigation",
    () =>
      Effect.gen(function* () {
        const markup = yield* inShell(FOCUS);

        expect(tagWith(markup, "data-shell=")).toContain('data-shell="focus"');
        expect(linksOf(topBarOf(markup))).toStrictEqual([
          { active: false, current: false, href: "/", text: Brand.name },
        ]);
        expect(markup).not.toContain("<nav");
        expect(markup).not.toContain("<footer");
      })
  );

  it.effect(
    "draw no route with the old rail, its slot, the bottom bar or the inspector",
    () =>
      Effect.gen(function* () {
        const markups = [
          yield* inShell(SITE),
          yield* inShell(PROJECT),
          yield* inShell(DOCS),
          yield* inShell(FOCUS),
        ].join("\n");

        expect(markups).not.toMatch(/\bdata-rail(?:-slot)?\b/u);
        expect(markups).not.toContain('aria-label="Site"');
        expect(markups).not.toContain('aria-label="Sections"');
        expect(markups).not.toContain('data-facts="inspector"');
        expect(markups).not.toMatch(/>Menu</u);
      })
  );
});

describe("the top bar", () => {
  const NAMED = [
    { href: "/", text: Brand.name },
    { href: "/explore", text: "Explore" },
    { href: "/asks", text: "Asks" },
    { href: "/docs", text: "Docs" },
    { href: "/agents", text: "Install" },
  ];

  it.effect(
    "is the same in the site, a project and the docs: the wordmark, Explore, Asks, Docs, Install, search and the account",
    () =>
      Effect.gen(function* () {
        const bars = [
          topBarOf(yield* inShell(SITE)),
          topBarOf(yield* inShell(PROJECT)),
          topBarOf(yield* inShell(DOCS)),
        ];

        const named = bars.map((bar) =>
          linksOf(bar)
            .filter(({ href }) => href?.startsWith("/auth/") !== true)
            .map(({ href, text }) => ({ href, text }))
        );

        expect(named).toStrictEqual([NAMED, NAMED, NAMED]);
        expect(
          bars.map((bar) => /<button\b[^>]*>[\s\S]*?Search/u.test(bar))
        ).toStrictEqual([true, true, true]);
        expect(
          bars.map((bar) =>
            linksOf(bar).some(
              ({ href, text }) =>
                href?.startsWith("/auth/signin") === true && text === "Sign in"
            )
          )
        ).toStrictEqual([true, true, true]);
      })
  );

  it.effect("sets the wordmark as the name in text, with no mark", () =>
    Effect.gen(function* () {
      const bar = topBarOf(yield* inShell(SITE));
      const wordmark = elementOf(bar, "a", 'href="/"');

      expect(textOf(wordmark)).toBe(Brand.name);
      expect(wordmark).not.toMatch(/<svg|<img/u);
    })
  );

  // A colour given to a kit button must not cost it the UI size: the
  // class merger reads an unknown `text-*` as a colour, so a colour class
  // drops `text-ui` and the button falls back to the body's 16 px.
  it.effect("sets every button in it at the UI size", () =>
    Effect.gen(function* () {
      const buttons = [
        ...topBarOf(yield* inShell(PROJECT)).matchAll(
          /<button\b[^>]*class="(?<classes>[^"]*)"/gu
        ),
      ].map(({ groups }) => groups?.classes?.split(" ") ?? []);

      expect(buttons.length).toBeGreaterThanOrEqual(2);
      expect(
        buttons.filter((classes) => !classes.includes("text-ui"))
      ).toStrictEqual([]);
    })
  );

  // The menu's button is `nav:hidden`, and the menu holds Keys; from `nav` up
  // this button is the `?` key's pointer twin.
  it.effect(
    "gives the keys a button in the site, a project and the docs, shown from nav up",
    () =>
      Effect.gen(function* () {
        const keys = [
          topBarOf(yield* inShell(SITE)),
          topBarOf(yield* inShell(PROJECT)),
          topBarOf(yield* inShell(DOCS)),
        ].map(
          (bar) =>
            /<span class="(?<wrap>[^"]*)"><button\b[^>]*>(?:(?!<\/button>)[\s\S])*?>Keys<\/span><\/button>/u
              .exec(bar)
              ?.groups?.wrap?.split(" ") ?? []
        );

        expect(
          keys.map((classes) => classes.includes("nav:flex"))
        ).toStrictEqual([true, true, true]);
      })
  );

  it.effect("marks the section being read as the current page", () =>
    Effect.gen(function* () {
      const bar = topBarOf(yield* inShell(DOCS));

      expect(
        linksOf(bar)
          .filter(({ active }) => active)
          .map(({ href }) => href)
      ).toStrictEqual(["/docs"]);
    })
  );
});

describe("the footer", () => {
  it.effect(
    "sets the brand's domain across the width, upper-cased by its style, under plain links",
    () =>
      Effect.gen(function* () {
        const footer = elementOf(yield* inShell(SITE), "footer", "data-footer");
        const domain = tagWith(footer, "data-domain");

        expect(textOf(elementOf(footer, "p", "data-domain"))).toBe(
          Brand.domain
        );
        expect(domain.split(/[\s"]/u)).toContain("uppercase");
        expect(linksOf(footer).map(({ text }) => text)).toStrictEqual([
          "Docs",
          "Install",
          "Privacy",
          "Terms",
        ]);
      })
  );
});

describe("every shell", () => {
  it.effect("lets a keyboard skip to the page's content", () =>
    Effect.gen(function* () {
      const markups = [
        yield* inShell(SITE),
        yield* inShell(PROJECT),
        yield* inShell(DOCS),
        yield* inShell(FOCUS),
      ];

      expect(
        markups.map((markup) =>
          /<a\b[^>]*href="#main"[^>]*>Skip to content<\/a>/u.test(markup)
        )
      ).toStrictEqual([true, true, true, true]);
    })
  );

  it.effect(
    "keeps the keys, and `?` for their list, with no rail to hold them",
    () =>
      Effect.gen(function* () {
        const probes = [
          yield* inShell(SITE, <KeysProbe />),
          yield* inShell(PROJECT, <KeysProbe />),
          yield* inShell(DOCS, <KeysProbe />),
          yield* inShell(FOCUS, <KeysProbe />),
        ];

        expect(
          probes.map((markup) => /data-keys="(?<keys>\w+)"/u.exec(markup)?.[1])
        ).toStrictEqual(["provided", "provided", "provided", "provided"]);
      })
  );

  it.effect("gives the page one main region", () =>
    Effect.gen(function* () {
      const markups = [
        yield* inShell(SITE),
        yield* inShell(PROJECT),
        yield* inShell(DOCS),
        yield* inShell(FOCUS),
      ];

      expect(
        markups.map((markup) => markup.split("<main").length - 1)
      ).toStrictEqual([1, 1, 1, 1]);
    })
  );
});

describe("a page's facts", () => {
  it.effect("sit in the page itself, never in a column beside it", () =>
    Effect.gen(function* () {
      const markup = yield* inShell(
        PROJECT,
        <Workspace
          facts={<p>Posture: open</p>}
          factsHeading="This ledger"
          title="Ledger"
        >
          <p>Entries</p>
        </Workspace>
      );

      const main = elementOf(markup, "main", 'id="main"');

      expect(elementOf(main, "section", 'data-facts="inline"')).toContain(
        "Posture: open"
      );
      expect(markup).not.toContain("<aside");
    })
  );

  it.effect("name no breadcrumb in a focused page", () =>
    Effect.gen(function* () {
      const markup = yield* inShell(
        FOCUS,
        <Workspace crumbs={[{ label: "Import a repo" }]} title="Import a repo">
          <p>Form</p>
        </Workspace>
      );

      expect(markup).not.toContain('aria-label="Breadcrumb"');
    })
  );
});

describe("the search", () => {
  it.effect(
    "lists every project by its full name, and ends with the way to import a repo",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/agents",
          <ProjectsSheetBody
            input={{ current: null }}
            listed={TEN_LISTED}
            onChosen={() => {}}
          />
        );

        expect(
          TEN_LISTED.filter(({ project }) => !markup.includes(`>${project}<`))
        ).toStrictEqual([]);
        expect(linksOf(markup).at(-1)).toMatchObject({
          href: "/import",
          text: "Import a repo",
        });
      })
  );
});

describe("the menu", () => {
  it.effect(
    "folds the top bar's links below nav, in its order, and opens the keys",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt("/agents", <MenuBody />);

        expect(
          linksOf(markup).map(({ href, text }) => ({ href, text }))
        ).toStrictEqual(
          SITE_LINKS.map(({ label, to }) => ({ href: to, text: label }))
        );
        expect(markup).toMatch(/<button\b[^>]*>[\s\S]*?Keys<\/button>/u);
      })
  );
});

const ProjectParamsView = () => {
  const { owner, project } = useParams({ strict: false });

  return (
    <p data-owner={owner} data-project={project}>
      <AppLink
        to={`${projectPath(ProjectName.make("github.com/pallets/click"))}/tree/main`}
      >
        tree
      </AppLink>
    </p>
  );
};

describe("a project at its source path", () => {
  it.effect(
    "reaches the project's pages with its owner in one param, and links back to the same address",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/github.com/pallets/click/tree/main",
          <ProjectParamsView />
        );

        expect(markup).toContain('data-owner="github.com/pallets"');
        expect(markup).toContain('data-project="github.com/pallets/click"');
        expect(linksOf(markup).map(({ href }) => href)).toStrictEqual([
          "/github.com/pallets/click/tree/main",
        ]);
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
        "/oscabriel/datekit/ledger",
        <p>
          <AppLink to="/oscabriel/datekit/blob/main/src/routes/$owner/$project/$.tsx">
            route
          </AppLink>
          <AppLink to="/oscabriel/datekit/blob/main/src/{-$x}.ts">
            optional
          </AppLink>
        </p>
      );

      const hrefs = linksOf(markup).map(({ href }) => href);

      expect(hrefs.map((href) => decodeURIComponent(href ?? ""))).toStrictEqual(
        [
          "/oscabriel/datekit/blob/main/src/routes/$owner/$project/$.tsx",
          "/oscabriel/datekit/blob/main/src/{-$x}.ts",
        ]
      );
    })
  );

  it("draws the same address with no router around it", () => {
    expect(
      renderToStaticMarkup(
        <AppLink to="/oscabriel/datekit/blob/main/src/routes/$owner/$project/$.tsx">
          route
        </AppLink>
      )
    ).toMatch(
      /href="\/oscabriel\/datekit\/blob\/main\/src\/routes\/(?:\$|%24)owner\/(?:\$|%24)project\/(?:\$|%24)\.tsx"/u
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
        path: "$owner/$project",
      });

      const router = createRouter({
        defaultErrorComponent: RouteError,
        history: createMemoryHistory({
          initialEntries: ["/oscabriel/datekit"],
        }),
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
      expect(markup).toContain("data-top-bar");
    })
  );
});
