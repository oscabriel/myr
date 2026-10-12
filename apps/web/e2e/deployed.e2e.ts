import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ProjectName } from "@repo/protocol/ids";
import { Config, Effect, Option } from "effect";

const examples = {
  burrow: {
    ask: "drop-legacy-fetch",
    file: "packages/kit/src/http.ts",
    readme: "six small TypeScript packages",
  },
  datekit: {
    ask: "format-ordinal",
    file: "src/add.ts",
    readme: "Small, dependency-free date helpers",
  },
} as const;

const settings = Effect.runSync(
  Effect.gen(function* () {
    const project = yield* Config.schema(ProjectName, "WEB_PROJECT").pipe(
      Config.withDefault(ProjectName.make("oscabriel/datekit"))
    );

    const example =
      project === "oscabriel/burrow" ? examples.burrow : examples.datekit;

    return {
      ask: yield* Config.NonEmptyString("WEB_ASK").pipe(
        Config.withDefault(example.ask)
      ),
      file: yield* Config.NonEmptyString("WEB_FILE").pipe(
        Config.withDefault(example.file)
      ),
      project,
      readme: yield* Config.NonEmptyString("WEB_README_PHRASE").pipe(
        Config.withDefault(example.readme)
      ),
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

const { ask, file: FILE, project, readme: README_PHRASE } = settings;

const FOLDER = FILE.split("/")[0] ?? FILE;

const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

const UNREACHABLE = "The platform did not answer";

const NOT_BUILT = "not built";

const at = (path: string) =>
  `${Option.getOrElse(settings.web, () => "")}${path}`;

// A text may also sit in markup a width hides, so each is found among the visible matches.
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
          expect(
            browser.getByText(text).filter({ visible: true }).first()
          ).toBeVisible()
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

  // The heading renders before the platform answers, so each list page also waits for a row only the answer holds.
  test("the front page lists the open asks", ({ page: browser }) =>
    Effect.runPromise(
      page(browser, "/", "front-page", ["Open asks", project])
    ));

  test(`${project}'s page shows the project`, ({ page: browser }) =>
    Effect.runPromise(
      page(browser, `/${project}`, "project-page", [project, ask])
    ));

  // A request, not a page: this is the HTML the server sent, as a crawler reads it.
  test(`${project}'s page arrives with its README rendered by the server`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          browser.request.get(at(`/${project}`))
        );

        const body = yield* Effect.promise(() => response.text());

        expect(response.status()).toBe(200);
        expect(body).toContain(README_PHRASE);
        expect(body).toContain('data-readme="');
      })
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
      code(browser, `/${project}/tree/main`, "code-tree", [FOLDER, "README.md"])
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
      Effect.gen(function* () {
        yield* code(browser, `/${project}/commits/main`, "code-log", [
          "Landings",
        ]);

        yield* Effect.promise(() =>
          expect(
            browser
              .locator("[data-day] h2")
              .first()
              .getByText(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/u)
          ).toBeVisible()
        );
      })
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
