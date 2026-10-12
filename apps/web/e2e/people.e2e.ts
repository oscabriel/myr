import { expect, test } from "@playwright/test";
import { ProjectName } from "@repo/protocol/ids";
import { Config, Effect, Option } from "effect";

const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
      project: yield* Config.schema(ProjectName, "WEB_PROJECT").pipe(
        Config.withDefault(ProjectName.make("oscabriel/datekit"))
      ),
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

const { project } = settings;

const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

const UNREACHABLE = "The platform did not answer";

test.describe("the deployed policy page", () => {
  test.skip(
    Option.isNone(settings.web),
    "WEB_URL is not set: point it at a deployed web's origin to run this check"
  );

  test(`${project}'s policy page shows its maintainers and the commit they are read at`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const web = Option.getOrElse(settings.web, () => "");

        const response = yield* Effect.promise(() =>
          browser.goto(`${web}/${project}/people`)
        );

        expect(response?.status()).toBe(200);

        yield* Effect.promise(() =>
          expect(
            browser.getByRole("heading", { level: 1, name: "Policy" })
          ).toBeVisible()
        );

        yield* Effect.promise(() =>
          expect(
            browser.getByRole("heading", { name: "Maintainers by path" })
          ).toBeVisible()
        );

        yield* Effect.promise(() =>
          expect(browser.locator('main [data-paths="**"]')).toBeVisible()
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
