/**
 * The deployed web, as a browser shows it: the front page, a
 * project's page, an ask's page and the same ask as Markdown,
 * `/llms.txt`, and the project's code (a folder, a file at a line, the
 * log, a commit and the refs), each asserted on its key text, each saved
 * as one screenshot in `e2e/out/` for the shot list.
 *
 * It runs only against `WEB_URL` (a stage's web origin) and is skipped
 * without it. `WEB_PROJECT` and `WEB_ASK` pick the project and the ask
 * (datekit's format-ordinal, which the seed opens on every stage, unless
 * given). It only reads.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Config, Effect, Option } from "effect";

/** What the check reads of its env: where the web lives, and which ask to look at. */
const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
      ask: yield* Config.NonEmptyString("WEB_ASK").pipe(
        Config.withDefault("format-ordinal")
      ),
      project: yield* Config.NonEmptyString("WEB_PROJECT").pipe(
        Config.withDefault("datekit")
      ),
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

const { ask, project } = settings;

/** Where each page's screenshot goes: `e2e/out/<shot>.png`. */
const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

/** What every page that could not reach the platform says instead of its content. */
const UNREACHABLE = "The platform did not answer";

/** What a code page said before its view was built; a deployed page never says it. */
const NOT_BUILT = "not built";

/** A file every seeded datekit has, and the line its page is opened at. */
const FILE = "src/add.ts";

/** `url` on the web. */
const at = (path: string) =>
  `${Option.getOrElse(settings.web, () => "")}${path}`;

/**
 * Opens `path` as a page, waits for each of `texts`, checks the platform
 * answered it, and saves the screenshot `shot`.
 */
const page = (
  browser: Page,
  path: string,
  shot: string,
  texts: readonly string[]
) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() => browser.goto(at(path)));

    expect(response?.status()).toBe(200);

    yield* Effect.forEach(
      texts,
      (text) =>
        Effect.promise(() =>
          expect(browser.getByText(text).first()).toBeVisible()
        ),
      { discard: true }
    );

    yield* Effect.promise(() =>
      expect(browser.getByText(UNREACHABLE)).toHaveCount(0)
    );

    yield* Effect.promise(() =>
      browser.screenshot({ fullPage: true, path: `${out}${shot}.png` })
    );
  });

/** A code page: as `page` checks one, and it never says it is not built. */
const code = (
  browser: Page,
  path: string,
  shot: string,
  texts: readonly string[]
) =>
  Effect.gen(function* () {
    yield* page(browser, path, shot, texts);

    yield* Effect.promise(() =>
      expect(browser.getByText(NOT_BUILT)).toHaveCount(0)
    );
  });

/**
 * Fetches `path` as Markdown, checks it opens with a title and holds each
 * of `texts`, and saves a screenshot of it, shown as plain text.
 */
const markdown = (
  browser: Page,
  path: string,
  shot: string,
  texts: readonly string[]
) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() => browser.request.get(at(path)));

    const body = yield* Effect.promise(() => response.text());

    expect({
      status: response.status(),
      title: body.startsWith("# "),
      type: response.headers()["content-type"]?.split(";")[0],
    }).toStrictEqual({ status: 200, title: true, type: "text/markdown" });

    for (const text of texts) {
      expect(body).toContain(text);
    }

    yield* Effect.promise(() =>
      browser.setContent(
        `<pre style="white-space: pre-wrap; font: 14px/1.5 monospace; margin: 24px"></pre>`
      )
    );

    yield* Effect.promise(() =>
      browser.locator("pre").evaluate((pre, text) => {
        pre.textContent = text;
      }, body)
    );

    yield* Effect.promise(() =>
      browser.screenshot({ fullPage: true, path: `${out}${shot}.png` })
    );
  });

test.describe("the deployed web", () => {
  test.skip(
    Option.isNone(settings.web),
    "WEB_URL is not set: point it at a deployed web's origin to run this check"
  );

  // The heading renders before the platform answers, so each list page also
  // waits for a row only the platform's answer holds: until then the page
  // shows placeholders, and "did not answer" can't have appeared yet.
  test("the front page lists the open asks", ({ page: browser }) =>
    Effect.runPromise(
      page(browser, "/", "front-page", ["Open asks", project])
    ));

  test(`${project}'s page shows the project`, ({ page: browser }) =>
    Effect.runPromise(
      page(browser, `/${project}`, "project-page", [project, ask])
    ));

  test(`${project}/${ask}'s page shows the ask`, ({ page: browser }) =>
    Effect.runPromise(
      page(browser, `/${project}/asks/${ask}`, "ask-page", [ask])
    ));

  test(`${project}/${ask}.md is the ask's brief in Markdown`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      markdown(browser, `/${project}/asks/${ask}.md`, "ask-markdown", [
        `Ask \`${ask}\` in ${project}`,
      ])
    ));

  test("/llms.txt is the web's Markdown for agents", ({ page: browser }) =>
    Effect.runPromise(markdown(browser, "/llms.txt", "llms-txt", [project])));

  test(`${project}'s code at main lists its folders and README`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      code(browser, `/${project}/tree/main`, "code-tree", ["src", "README.md"])
    ));

  test(`${project}'s ${FILE} opens at line 3`, ({ page: browser }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* code(browser, `/${project}/blob/main/${FILE}#L3`, "code-file", [
          FILE,
          "Permalink",
        ]);

        expect(new URL(browser.url()).hash).toBe("#L3");
      })
    ));

  test(`${project}'s log groups its commits by day`, ({ page: browser }) =>
    Effect.runPromise(
      code(browser, `/${project}/commits/main`, "code-log", ["Commits on"])
    ));

  test(`${project}'s newest commit shows what it changed`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          browser.goto(at(`/${project}/commits/main`))
        );

        const href = yield* Effect.promise(() =>
          browser
            .locator(`a[href^="/${project}/commit/"]`)
            .first()
            .getAttribute("href")
        );

        expect(href).toMatch(/\/commit\/[0-9a-f]{40}$/u);

        yield* code(browser, href ?? "", "code-commit", ["changed"]);
      })
    ));

  test(`${project}'s refs show main and its tags`, ({ page: browser }) =>
    Effect.runPromise(
      code(browser, `/${project}/refs`, "code-refs", ["main", "Tags", "Forks"])
    ));
});
