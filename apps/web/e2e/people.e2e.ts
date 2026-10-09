/**
 * The deployed people page, as a browser shows it: who decides which paths
 * and the commit the config is read at, saved as `e2e/out/people.png` for
 * the shot list.
 *
 * It runs only against `WEB_URL` (a stage's web origin) and is skipped
 * without it. `WEB_PROJECT` picks the project (datekit, which the seed puts
 * on every stage, unless given). It only reads.
 */
import { expect, test } from "@playwright/test";
import { Config, Effect, Option } from "effect";

/** What the check reads of its env: where the web lives, and which project to look at. */
const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
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

const { project } = settings;

/** Where the screenshot goes: `e2e/out/people.png`. */
const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

/** What every page that could not reach the platform says instead of its content. */
const UNREACHABLE = "The platform did not answer";

test.describe("the deployed people page", () => {
  test.skip(
    Option.isNone(settings.web),
    "WEB_URL is not set: point it at a deployed web's origin to run this check"
  );

  test(`${project}'s people page shows its deciders and the commit they are read at`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const web = Option.getOrElse(settings.web, () => "");

        const response = yield* Effect.promise(() =>
          browser.goto(`${web}/${project}/people`)
        );

        expect(response?.status()).toBe(200);

        // The deciders table: its header and at least the whole-repo glob's row.
        yield* Effect.promise(() =>
          expect(
            browser.getByRole("columnheader", { name: "Deciders" })
          ).toBeVisible()
        );

        yield* Effect.promise(() =>
          expect(browser.locator('tr[data-paths="**"]')).toBeVisible()
        );

        yield* Effect.promise(() =>
          expect(browser.getByText(/^As of [0-9a-f]{7}/u).first()).toBeVisible()
        );

        yield* Effect.promise(() =>
          expect(browser.getByText(UNREACHABLE)).toHaveCount(0)
        );

        yield* Effect.promise(() =>
          browser.screenshot({ fullPage: true, path: `${out}people.png` })
        );
      })
    ));
});
