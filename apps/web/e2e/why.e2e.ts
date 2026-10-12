import { expect, test } from "@playwright/test";
import { Brand } from "@repo/brand";
import { ProjectName } from "@repo/protocol/ids";
import { Config, Effect, Option } from "effect";

const settings = Effect.runSync(
  Effect.gen(function* () {
    const project = yield* Config.schema(ProjectName, "WEB_PROJECT").pipe(
      Config.withDefault(ProjectName.make("oscabriel/datekit"))
    );

    return {
      path: yield* Config.NonEmptyString("WEB_WHY_PATH").pipe(
        Config.withDefault(
          project === "oscabriel/burrow"
            ? `${Brand.configDir}/asks/drop-legacy-fetch.ask.ts`
            : "src/format.ts"
        )
      ),
      project,
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

const { path, project } = settings;

const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

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
