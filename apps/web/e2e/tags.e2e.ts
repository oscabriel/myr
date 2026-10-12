import { expect, test } from "@playwright/test";
import { ProjectName } from "@repo/protocol/ids";
import { Config, Effect, Option } from "effect";

const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
      project: yield* Config.schema(ProjectName, "WEB_TAGS_PROJECT").pipe(
        Config.withDefault(ProjectName.make("github.com/changesets/changesets"))
      ),
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

const { project } = settings;

const PACKAGE = "@changesets/cli";

const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

const UNREACHABLE = "The platform did not answer";

const awaited = <A>(promise: () => Promise<A>) => Effect.promise(promise);

const numbersOf = (tag: string) =>
  (tag.slice(tag.lastIndexOf("@") + 1).match(/\d+/gu) ?? [])
    .slice(0, 3)
    .map(Number);

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

        const row = browser.locator(`[data-package="${PACKAGE}"]`);

        yield* awaited(() => expect(row).toBeVisible());

        const href = yield* awaited(() =>
          row.locator("a").first().getAttribute("href")
        );

        expect(href).toBe(
          `/${project}/refs?package=${encodeURIComponent(PACKAGE)}`
        );

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

        const tree = yield* awaited(() =>
          tags.first().locator("a").first().getAttribute("href")
        );

        expect(
          tree?.startsWith(
            `/${project}/tree/${encodeURIComponent(`${PACKAGE}@`)}`
          )
        ).toBe(true);

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
