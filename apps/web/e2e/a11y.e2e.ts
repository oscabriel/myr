/**
 * Every page of the web, as a browser and a keyboard reach it, in both
 * colour schemes at 1440 and 390 px wide:
 *
 * - axe-core finds no serious or critical violation (it is loaded from
 *   cdnjs into the page at run time, so no package is added for it);
 * - no page scrolls sideways at 390 or 360;
 * - no word the web keeps off its screens (review, approve, merge, queue,
 *   …) appears in its own chrome; text that comes from a repository or a
 *   person (a README, code, a diff, a want, a brief, a commit message, a
 *   note, a refusal's own text) is left out by the marker its view sets;
 * - the keyboard: the skip link is the first stop and lands on main; focus
 *   shows on every stop; the rail, the toolbar's filters, a row's copy
 *   button and the inspector's commands come in that order; `?` opens the
 *   keys dialog, whose switch turns `j`/`k` off; `j`/`k` move the
 *   selection on the front page and Today; `J`/`K` move between files on a
 *   commit and a finish; `1` copies the inspector's first command; every
 *   sheet keeps focus inside it and gives it back to its button on Escape.
 *
 * It runs only against `WEB_URL`, the web's dev world with its fixtures
 * (`VITE_DEV_FIXTURES=1 bun run dev -- --port <port>`): the pages it visits
 * are the fixture project's, and it signs in through the dev world's own
 * `/auth/dev`. `A11Y_PROJECT` names the fixture project by its full name
 * (`oscabriel/vellum` unless given). It only reads, but for the keys switch, kept in this browser.
 */
import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { Brand } from "@repo/brand";
import { Config, Effect, Option } from "effect";

import { axeOn, sideways } from "./axe.ts";

const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
      project: yield* Config.NonEmptyString("A11Y_PROJECT").pipe(
        Config.withDefault("oscabriel/vellum")
      ),
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

const { project } = settings;

const at = (path: string) =>
  `${Option.getOrElse(settings.web, () => "")}${path}`;

/** The decider the dev world signs in. */
const DECIDER = "ines-v";

/** A page to visit: where, whether a decider must be signed in, what it answers. */
interface Visit {
  readonly name: string;
  readonly path: string;
  readonly signedIn?: boolean;
  readonly status?: number;
}

/**
 * The commit page's address comes from the landings page (its SHA is the
 * dev world's), so it is visited by name and found at run time: the newest
 * ask opening, which changes two files or more (the ask and its check).
 */
const COMMIT = "<the newest ask opening>";

/** Every page group, over the fixture project's states. */
const VISITS: readonly Visit[] = [
  { name: "landing", path: "/" },
  { name: "front", path: "/asks" },
  { name: "front, signed in", path: "/asks", signedIn: true },
  { name: "today", path: "/today", signedIn: true },
  { name: "today, signed out", path: "/today" },
  { name: "project home", path: `/${project}` },
  { name: "project home, examples", path: "/oscabriel/burrow" },
  { name: "project home, no open asks", path: "/lin-h/mossgate" },
  { name: "ask, open", path: `/${project}/asks/lint-heading-levels` },
  {
    name: "ask, held for newcomers",
    path: `/${project}/asks/document-cli-flags`,
  },
  { name: "ask, claimed", path: `/${project}/asks/number-footnotes` },
  { name: "ask, a family", path: `/${project}/asks/retire-old-tokenizer` },
  {
    name: "answer, checking",
    path: `/${project}/answers/retire-old-tokenizer-vellum-lint`,
  },
  {
    name: "answer, waiting on a finish",
    path: `/${project}/answers/wrap-long-table-cells`,
  },
  {
    name: "answer, refused",
    path: `/${project}/answers/trim-trailing-spaces`,
  },
  {
    name: "answer, held back",
    path: `/${project}/answers/retire-old-tokenizer-vellum-parser`,
  },
  {
    name: "answer, landed",
    path: `/${project}/answers/carry-footnotes-to-epub`,
  },
  {
    name: "answer, unclaimed",
    path: `/${project}/answers/lint-heading-levels`,
  },
  { name: "ledger", path: `/${project}/ledger` },
  { name: "env shape", path: `/${project}/env` },
  { name: "policy", path: `/${project}/people` },
  { name: "refs", path: `/${project}/refs` },
  { name: "tree", path: `/${project}/tree/main` },
  { name: "folder", path: `/${project}/tree/main/packages/render/src` },
  { name: "blob", path: `/${project}/blob/main/packages/render/src/page.ts` },
  { name: "why", path: `/${project}/why/main/packages/render/src/page.ts` },
  { name: "landings", path: `/${project}/commits/main` },
  { name: "commit", path: COMMIT },
  {
    name: "decision",
    path: `/${project}/decisions/dec-000002`,
    signedIn: true,
  },
  {
    name: "decision, signed out",
    path: `/${project}/decisions/dec-000002`,
  },
  { name: "finish", path: `/${project}/decisions/dec-000004`, signedIn: true },
  { name: "proposal, ready", path: `/${project}/proposals/prop-000002` },
  { name: "proposal, failed", path: `/${project}/proposals/prop-000003` },
  {
    name: "propose",
    path: `/${project}/proposals/new`,
    signedIn: true,
  },
  { name: "propose, signed out", path: `/${project}/proposals/new` },
  { name: "person", path: `/people/${DECIDER}` },
  { name: "for agents", path: "/agents" },
  { name: "unknown project", path: "/no-such-project", status: 404 },
  {
    name: "unknown ask",
    path: `/${project}/asks/no-such-ask`,
    status: 404,
  },
  {
    name: "unknown path",
    path: `/${project}/blob/main/no/such/file.ts`,
    status: 404,
  },
];

const SCHEMES = ["light", "dark"] as const;

const WIDTHS = [1440, 390] as const;

/**
 * Words the web keeps off its screens, matched whole and in any case
 * ("merged tree" passes; "merge" does not).
 */
const FORBIDDEN =
  /\b(?:review|reviewer|approve|approval|PR|pull request|issue|merge|lease|reputation|inbox|queue|dashboard|explore|trending|nit)\b/iu;

/**
 * Text a repository or a person wrote, which the web shows as given: the
 * views mark each such block (`data-said` for a want, a brief, a commit's
 * subject or body, a note). A refusal's own text comes from the one
 * renderer every surface shares (`data-refusal`), and the gate's own names
 * for its stages ("Merge") are the protocol's (`data-term`).
 */
const NOT_OURS =
  "[data-readme], [data-code], [data-diff], [data-said], [data-refusal], [data-term], script, style, noscript";

/** A context for `scheme` at `width`, signed in as the decider when asked. */
const contextFor = (
  browser: Browser,
  scheme: (typeof SCHEMES)[number],
  width: number,
  signedIn: boolean
) =>
  Effect.gen(function* () {
    const context = yield* Effect.promise(() =>
      browser.newContext({
        colorScheme: scheme,
        viewport: { height: width > 800 ? 900 : 844, width },
      })
    );

    if (signedIn) {
      const page = yield* Effect.promise(() => context.newPage());

      yield* Effect.promise(() => page.goto(at(`/auth/dev?handle=${DECIDER}`)));

      yield* Effect.promise(() => page.close());
    }

    return context;
  });

/** The newest landing's commit page, read from the landings page. */
const commitPath = (context: BrowserContext) =>
  Effect.gen(function* () {
    const page = yield* Effect.promise(() => context.newPage());

    yield* Effect.promise(() => page.goto(at(`/${project}/commits/main`)));

    const href = yield* Effect.promise(() =>
      page
        .locator(`a[href^="/${project}/commit/"]`, { hasText: "Open ask" })
        .first()
        .getAttribute("href")
    );

    yield* Effect.promise(() => page.close());

    return href ?? `/${project}/commits/main`;
  });

/** Open `path` and let the browser take the page over. */
const open = (page: Page, path: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      page.goto(at(path), { waitUntil: "load" })
    );

    // The page hydrates, then its client reads settle (lists, the tree).
    yield* Effect.promise(() => page.waitForTimeout(1500));

    return response?.status();
  });

/** The page's own words that the web keeps off its screens. */
const forbiddenOn = (page: Page) =>
  Effect.promise(() =>
    page.evaluate(
      ({ forbidden, notOurs }) => {
        const pattern = new RegExp(forbidden, "iu");

        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT
        );

        const found: string[] = [];

        for (
          let node = walker.nextNode();
          node !== null;
          node = walker.nextNode()
        ) {
          const parent = node.parentElement;
          const text = node.textContent ?? "";

          if (
            parent !== null &&
            parent.closest(notOurs) === null &&
            parent.checkVisibility() &&
            pattern.test(text)
          ) {
            found.push(text.trim().slice(0, 80));
          }
        }

        return found;
      },
      { forbidden: FORBIDDEN.source, notOurs: NOT_OURS }
    )
  );

test.describe("every page, by axe, at two widths, in both schemes", () => {
  test.skip(
    Option.isNone(settings.web),
    "WEB_URL is not set: point it at the web's dev world, with its fixtures"
  );

  for (const visit of VISITS) {
    test(`${visit.name}: no serious violation, no sideways scroll, no forbidden word`, ({
      browser,
    }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const problems: string[] = [];

          for (const scheme of SCHEMES) {
            for (const width of WIDTHS) {
              const context = yield* contextFor(
                browser,
                scheme,
                width,
                visit.signedIn === true
              );

              const path =
                visit.path === COMMIT ? yield* commitPath(context) : visit.path;

              const page = yield* Effect.promise(() => context.newPage());
              const status = yield* open(page, path);
              const where = `${scheme} ${width} ${path}`;

              if (status !== (visit.status ?? 200)) {
                problems.push(`${where}: answered ${status}`);
              }

              for (const violation of yield* axeOn(page)) {
                problems.push(`${where}: ${violation}`);
              }

              const over = yield* sideways(page);

              if (over > 0) {
                problems.push(`${where}: scrolls ${over}px sideways`);
              }

              if (width === 390) {
                yield* Effect.promise(() =>
                  page.setViewportSize({ height: 780, width: 360 })
                );

                const narrow = yield* sideways(page);

                if (narrow > 0) {
                  problems.push(
                    `${where} at 360: scrolls ${narrow}px sideways`
                  );
                }
              }

              for (const words of yield* forbiddenOn(page)) {
                problems.push(`${where}: forbidden word in "${words}"`);
              }

              yield* Effect.promise(() => context.close());
            }
          }

          expect(problems).toStrictEqual([]);
        })
      ));
  }
});

/** What has focus: its tag, its name, and the landmark it sits in. */
const focused = (page: Page) =>
  Effect.promise(() =>
    page.evaluate(() => {
      // Focus inside a drawing's shadow root (a code box, the file tree) is
      // the inner element's own; where it sits is its host's place.
      const { activeElement: host } = document;

      let element = host;

      while (element?.shadowRoot?.activeElement) {
        element = element.shadowRoot.activeElement;
      }

      if (!(element instanceof HTMLElement) || element === document.body) {
        return null;
      }

      const style = getComputedStyle(element);
      const after = getComputedStyle(element, "::after");

      // Where the stop sits, first match wins.
      const places = [
        ["[role=dialog]", "dialog"],
        ["nav[aria-label=Site]", "rail"],
        ["[data-toolbar]", "toolbar"],
        ["aside[aria-label=Facts]", "facts"],
        ["main li", "row"],
      ] as const;

      return {
        id: element.id,
        inside:
          places.find(([selector]) => host?.closest(selector) !== null)?.[1] ??
          "main",
        label: (element.getAttribute("aria-label") ?? element.textContent ?? "")
          .trim()
          .slice(0, 60),
        tag: element.tagName.toLowerCase(),
        // The ring: an outline, a row link's outline drawn on its ::after,
        // or the kit's box-shadow ring.
        visible:
          (style.outlineStyle !== "none" && style.outlineWidth !== "0px") ||
          (after.outlineStyle !== "none" && after.outlineWidth !== "0px") ||
          style.boxShadow !== "none",
      };
    })
  );

/**
 * Tab through the page, up to `limit` stops, and what each stop was;
 * `settle` waits after each press (a sheet's trap moves focus in the next
 * frame).
 */
const tabStops = (page: Page, limit: number, settle = 0) =>
  Effect.gen(function* () {
    const stops: NonNullable<Effect.Success<ReturnType<typeof focused>>>[] = [];

    for (let index = 0; index < limit; index += 1) {
      yield* Effect.promise(() => page.keyboard.press("Tab"));

      if (settle > 0) {
        yield* Effect.promise(() => page.waitForTimeout(settle));
      }

      const stop = yield* focused(page);

      if (stop === null) {
        break;
      }

      stops.push(stop);
    }

    return stops;
  });

/** A page on its own context, for a keyboard walk. */
const keyboardPage = (
  browser: Browser,
  path: string,
  width: number,
  signedIn = false
) =>
  Effect.gen(function* () {
    const context = yield* contextFor(browser, "light", width, signedIn);

    yield* Effect.promise(() =>
      context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: at("/"),
      })
    );

    const page = yield* Effect.promise(() => context.newPage());

    yield* open(page, path === COMMIT ? yield* commitPath(context) : path);

    return { context, page };
  });

const searchOf = (page: Page) => new URL(page.url()).searchParams;

test.describe("the keyboard", () => {
  test.skip(
    Option.isNone(settings.web),
    "WEB_URL is not set: point it at the web's dev world, with its fixtures"
  );

  test("the skip link comes first, lands on main, and every stop shows its focus", ({
    browser,
  }) => {
    // Every page, each tabbed through: far longer than one page's check.
    test.setTimeout(VISITS.length * 30_000);

    return Effect.runPromise(
      Effect.gen(function* () {
        const problems: string[] = [];

        for (const visit of VISITS) {
          const { context, page } = yield* keyboardPage(
            browser,
            visit.path,
            1440,
            visit.signedIn === true
          );

          yield* Effect.promise(() => page.keyboard.press("Tab"));

          const first = yield* focused(page);

          if (first?.label !== "Skip to content") {
            problems.push(`${visit.name}: first stop is ${first?.label}`);
          }

          yield* Effect.promise(() => page.keyboard.press("Enter"));

          const landed = yield* Effect.promise(() =>
            page.evaluate(() => {
              const active = document.activeElement;

              return (
                active?.id === "main" ||
                (active !== null && active.closest("#main") !== null)
              );
            })
          );

          if (!landed || !page.url().endsWith("#main")) {
            problems.push(`${visit.name}: the skip link does not land on main`);
          }

          const stops = yield* tabStops(page, 80);

          for (const stop of stops.filter(({ visible }) => !visible)) {
            problems.push(
              `${visit.name}: no visible focus on ${stop.tag} "${stop.label}"`
            );
          }

          yield* Effect.promise(() => context.close());
        }

        expect(problems).toStrictEqual([]);
      })
    );
  });

  test("the rail, the toolbar's filters, a row's copy button and the inspector's commands come in order", ({
    browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { context, page } = yield* keyboardPage(browser, "/asks", 1440);

        // A row selected, so the inspector holds its commands; then the
        // same address again, tabbed from its start.
        yield* Effect.promise(() => page.keyboard.press("j"));
        yield* Effect.promise(() => page.waitForTimeout(500));
        yield* open(
          page,
          new URL(page.url()).pathname + new URL(page.url()).search
        );

        const stops = yield* tabStops(page, 200);

        const first = (inside: string) =>
          stops.findIndex((stop) => stop.inside === inside);

        const copy = stops.findIndex(
          (stop) => stop.inside === "row" && stop.label.startsWith("Copy")
        );

        const order = {
          facts: first("facts"),
          rail: first("rail"),
          rowCopy: copy,
          toolbar: first("toolbar"),
        };

        expect(Object.values(order).every((index) => index >= 0)).toBe(true);
        expect(order.rail).toBeLessThan(order.toolbar);
        expect(order.toolbar).toBeLessThan(order.rowCopy);
        expect(order.rowCopy).toBeLessThan(order.facts);

        yield* Effect.promise(() => context.close());
      })
    ));

  test("? opens the keys, whose switch turns j and k off; j and k move the selection", ({
    browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const [path, param, signedIn] of [
          ["/asks", "ask", false],
          ["/today", "decision", true],
        ] as const) {
          const { context, page } = yield* keyboardPage(
            browser,
            path,
            1440,
            signedIn
          );

          yield* Effect.promise(() => page.keyboard.press("j"));
          yield* Effect.promise(() => page.waitForTimeout(400));

          const firstSelected = searchOf(page).get(param);

          expect(firstSelected).not.toBeNull();

          yield* Effect.promise(() => page.keyboard.press("j"));
          yield* Effect.promise(() => page.waitForTimeout(400));

          const second = searchOf(page).get(param);

          expect(second).not.toBe(firstSelected);

          yield* Effect.promise(() => page.keyboard.press("k"));
          yield* Effect.promise(() => page.waitForTimeout(400));

          expect(searchOf(page).get(param)).toBe(firstSelected);

          // The switch: off, `j` does nothing; `?` still opens the dialog.
          yield* Effect.promise(() => page.keyboard.press("?"));

          const dialog = page.getByRole("dialog", { name: "Keys" });

          yield* Effect.promise(() => expect(dialog).toBeVisible());
          yield* Effect.promise(() =>
            dialog.getByRole("button", { name: "Off" }).click()
          );
          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* Effect.promise(() => expect(dialog).toBeHidden());

          yield* Effect.promise(() => page.keyboard.press("j"));
          yield* Effect.promise(() => page.waitForTimeout(400));

          expect(searchOf(page).get(param)).toBe(firstSelected);

          yield* Effect.promise(() => page.keyboard.press("?"));
          yield* Effect.promise(() => expect(dialog).toBeVisible());
          yield* Effect.promise(() =>
            dialog.getByRole("button", { name: "On" }).click()
          );
          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* Effect.promise(() => context.close());
        }
      })
    ));

  test("1 copies the inspector's first command", ({ browser }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { context, page } = yield* keyboardPage(browser, "/asks", 1440);

        yield* Effect.promise(() => page.keyboard.press("j"));
        yield* Effect.promise(() => page.waitForTimeout(500));
        yield* Effect.promise(() => page.keyboard.press("1"));
        yield* Effect.promise(() => page.waitForTimeout(300));

        const copied = yield* Effect.promise(() =>
          page.evaluate(() => navigator.clipboard.readText())
        );

        const ask = searchOf(page).get("ask") ?? "";

        // The selected row's own claim command, as its copy button holds it.
        const command = yield* Effect.promise(() =>
          page
            .locator(`li[data-ask="${ask}"] button code`)
            .first()
            .textContent()
        );

        expect(copied).toMatch(new RegExp(`^${Brand.cli} claim ${ask} `, "u"));
        expect(copied).toBe(command);

        yield* Effect.promise(() => context.close());
      })
    ));

  test("J and K move between files on a commit and a finish", ({ browser }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const [path, signedIn] of [
          [COMMIT, false],
          [`/${project}/decisions/dec-000004`, true],
        ] as const) {
          const { context, page } = yield* keyboardPage(
            browser,
            path,
            1440,
            signedIn
          );

          yield* Effect.promise(() => page.keyboard.press("Shift+J"));
          yield* Effect.promise(() => page.waitForTimeout(400));

          const first = new URL(page.url()).hash;

          expect(first).not.toBe("");

          yield* Effect.promise(() => page.keyboard.press("Shift+J"));
          yield* Effect.promise(() => page.waitForTimeout(400));

          const second = new URL(page.url()).hash;

          expect(second).not.toBe(first);

          yield* Effect.promise(() => page.keyboard.press("Shift+K"));
          yield* Effect.promise(() => page.waitForTimeout(400));

          expect(new URL(page.url()).hash).toBe(first);

          yield* Effect.promise(() => context.close());
        }
      })
    ));

  test("each sheet keeps focus inside, and Escape gives it back to its button", ({
    browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const sheets = [
          { button: "Menu", path: `/${project}`, width: 800 },
          {
            button: "Files",
            path: `/${project}/blob/main/packages/render/src/page.ts`,
            width: 390,
          },
          { button: "Projects", path: "/asks", width: 390 },
          { button: "More", path: `/${project}`, width: 390 },
        ] as const;

        const problems: string[] = [];

        for (const sheet of sheets) {
          const { context, page } = yield* keyboardPage(
            browser,
            sheet.path,
            sheet.width
          );

          const button = page
            .getByRole("button", { exact: true, name: sheet.button })
            .first();

          yield* Effect.promise(() => button.focus());
          yield* Effect.promise(() => page.keyboard.press("Enter"));

          const dialog = page.getByRole("dialog");

          yield* Effect.promise(() => expect(dialog).toBeVisible());

          const stops = yield* tabStops(page, 30, 120);

          if (stops.some(({ inside }) => inside !== "dialog")) {
            problems.push(`${sheet.button}: focus leaves the sheet`);
          }

          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* Effect.promise(() => expect(dialog).toBeHidden());

          const back = yield* focused(page);

          if (back?.label !== sheet.button) {
            problems.push(
              `${sheet.button}: focus returns to ${back?.label ?? "nothing"}`
            );
          }

          yield* Effect.promise(() => context.close());
        }

        expect(problems).toStrictEqual([]);
      })
    ));
});
