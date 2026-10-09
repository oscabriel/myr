/**
 * A monorepo's tags on a deployed web, as a browser shows them: the refs
 * page's first view lists the packages the tags version, `@changesets/cli`
 * among them; its link lists that package's tags alone, newest first; and
 * the first one's tree opens. The package's page is saved as
 * `e2e/out/tags.png` for the shot list.
 *
 * It runs only against `WEB_URL` (a stage's web origin) and is skipped
 * without it. `WEB_TAGS_PROJECT` picks the project (changesets, which
 * `scripts/import-examples.ts` puts on a dev stage, unless given). It only
 * reads.
 */
import { expect, test } from "@playwright/test";
import { Config, Effect, Option } from "effect";

/** What the check reads of its env: where the web lives, and which project to look at. */
const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
      project: yield* Config.NonEmptyString("WEB_TAGS_PROJECT").pipe(
        Config.withDefault("changesets")
      ),
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

const { project } = settings;

/** The package whose tags the check follows. */
const PACKAGE = "@changesets/cli";

/** Where the screenshot goes: `e2e/out/tags.png`. */
const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

/** What every page that could not reach the platform says instead of its content. */
const UNREACHABLE = "The platform did not answer";

const awaited = <A>(promise: () => Promise<A>) => Effect.promise(promise);

/** A tag's release numbers (`@changesets/cli@2.27.1` → 2, 27, 1). */
const numbersOf = (tag: string) =>
  (tag.slice(tag.lastIndexOf("@") + 1).match(/\d+/gu) ?? [])
    .slice(0, 3)
    .map(Number);

/** `one` is no older than `other` by their first three numbers. */
const noOlder = (one: readonly number[], other: readonly number[]) => {
  const at = one.findIndex((value, index) => value !== (other[index] ?? 0));

  return at === -1 || (one[at] ?? 0) > (other[at] ?? 0);
};

test.describe("a monorepo's tags", () => {
  test.skip(
    Option.isNone(settings.web),
    "WEB_URL is not set: point it at a deployed web's origin to run this check"
  );

  test(`${project}'s refs list its packages, and ${PACKAGE}'s tags newest first`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const web = Option.getOrElse(settings.web, () => "");

        const response = yield* awaited(() =>
          browser.goto(`${web}/${project}/refs`)
        );

        expect(response?.status()).toBe(200);

        // The first view: the package list, holding the package.
        const row = browser.locator(`[data-package="${PACKAGE}"]`);

        yield* awaited(() => expect(row).toBeVisible());

        const href = yield* awaited(() =>
          row.locator("a").first().getAttribute("href")
        );

        expect(href).toBe(
          `/${project}/refs?package=${encodeURIComponent(PACKAGE)}`
        );

        // Its link: that package's tags alone, newest first.
        yield* awaited(() => browser.goto(`${web}${href ?? ""}`));

        const tags = browser.locator("[data-tag]");

        yield* awaited(() => expect(tags.first()).toBeVisible());

        const names = yield* awaited(() =>
          tags.evaluateAll((items) =>
            items.map((item) => item.dataset.tag ?? "")
          )
        );

        expect(names.length).toBeGreaterThan(1);
        expect(names.every((name) => name.startsWith(`${PACKAGE}@`))).toBe(
          true
        );
        expect(
          names
            .slice(1)
            .every((name, at) =>
              noOlder(numbersOf(names[at] ?? ""), numbersOf(name))
            )
        ).toBe(true);
        yield* awaited(() =>
          expect(browser.getByText(UNREACHABLE)).toHaveCount(0)
        );
        yield* awaited(() =>
          browser.screenshot({ fullPage: true, path: `${out}tags.png` })
        );

        // The newest tag's tree opens.
        const tree = yield* awaited(() =>
          tags.first().locator("a").first().getAttribute("href")
        );

        expect(tree).toMatch(
          new RegExp(
            `^/${project}/tree/${encodeURIComponent(`${PACKAGE}@`)}`,
            "u"
          )
        );

        const opened = yield* awaited(() =>
          browser.goto(`${web}${tree ?? ""}`)
        );

        expect(opened?.status()).toBe(200);
        yield* awaited(() =>
          expect(browser.locator("[data-entry]").first()).toBeVisible()
        );
      })
    ));
});
