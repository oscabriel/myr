/**
 * The deployed "why" page, as a browser shows it: a file a landing changed,
 * with at least one row linking an ask, saved as `e2e/out/why.png` for the
 * shot list. The ask a landing answers counts, and so does the ask an
 * opening opened ("Open ask <id>"), so a stage whose landings are only
 * openings (an import's, or demo's, where nothing is answered) passes on an
 * opening's file.
 *
 * It runs only against `WEB_URL` (a stage's web origin) and is skipped
 * without it. `WEB_PROJECT` picks the project (datekit, which the seed puts
 * on every stage, unless given) and `WEB_WHY_PATH` the file (datekit's
 * `src/format.ts` unless given; per stage, an opening's file such as
 * the config folder's `asks/format-ordinal.ask.ts`). It only reads.
 */
import { expect, test } from "@playwright/test";
import { Config, Effect, Option } from "effect";

/** What the check reads of its env: where the web lives, and which file to look at. */
const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
      path: yield* Config.NonEmptyString("WEB_WHY_PATH").pipe(
        Config.withDefault("src/format.ts")
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

const { path, project } = settings;

/** Where the screenshot goes: `e2e/out/why.png`. */
const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

/** What every page that could not reach the platform says instead of its content. */
const UNREACHABLE = "The platform did not answer";

test.describe("the deployed why page", () => {
  test.skip(
    Option.isNone(settings.web),
    "WEB_URL is not set: point it at a deployed web's origin to run this check"
  );

  test(`${project}'s ${path} names the landing behind its lines, with the ask it links`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const web = Option.getOrElse(settings.web, () => "");

        const response = yield* Effect.promise(() =>
          browser.goto(`${web}/${project}/why/main/${path}`)
        );

        expect(response?.status()).toBe(200);

        // A range's row, in the server's table or above the drawn lines,
        // linking the ask its landing answered or opened.
        yield* Effect.promise(() =>
          expect(
            browser.locator(`[data-range] a[href^="/${project}/asks/"]`).first()
          ).toBeVisible()
        );

        yield* Effect.promise(() =>
          expect(browser.getByText(UNREACHABLE)).toHaveCount(0)
        );

        yield* Effect.promise(() =>
          browser.screenshot({ fullPage: true, path: `${out}why.png` })
        );
      })
    ));
});
