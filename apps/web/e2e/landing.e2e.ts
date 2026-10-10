/**
 * The landing as a first-time reader meets it in a browser: the page as
 * sent names its projects, so a reader with no script sees them; its first
 * action takes them to the open asks; and on the narrowest phone it scrolls
 * nothing sideways and axe finds no serious or critical violation, in
 * either scheme.
 * `a11y.e2e.ts` checks it with every other page at 1440 and 390 px.
 *
 * It runs only against `WEB_URL` (a stage's web origin, or a `vite dev`
 * with the dev fixtures) and is skipped without it. It only reads, signed
 * out.
 */
import { expect, test } from "@playwright/test";
import { Config, Effect, Option } from "effect";

import { axeOn, sideways } from "./axe.ts";

/** Where the web lives. */
const web = Effect.runSync(
  Config.option(Config.NonEmptyString("WEB_URL")).pipe(
    Effect.map(Option.map((url) => url.replace(/\/+$/u, "")))
  )
);

const at = (path: string) => `${Option.getOrElse(web, () => "")}${path}`;

/** The narrowest phone the web is drawn for. */
const NARROWEST = 360;

test.describe("the landing", () => {
  test.skip(
    Option.isNone(web),
    "WEB_URL is not set: point it at a web's origin to run this check"
  );

  test("names its projects in the page as sent, before any script runs", ({
    page,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => page.request.get(at("/")));
        const html = yield* Effect.promise(() => response.text());

        expect(response.status()).toBe(200);
        expect(html).toMatch(/data-project="[^"]+"/u);
        expect(html).toMatch(/data-posture="[^"]+"/u);
      })
    ));

  test("leads to the open asks", ({ page }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => page.goto(at("/")));

        yield* Effect.promise(() =>
          page.getByRole("link", { name: "See the open asks" }).click()
        );

        yield* Effect.promise(() => page.waitForURL(at("/asks")));

        yield* Effect.promise(() =>
          expect(
            page.getByRole("heading", { level: 1, name: "Open asks" })
          ).toBeVisible()
        );
      })
    ));

  for (const scheme of ["light", "dark"] as const) {
    test(`fits ${NARROWEST} px with no serious violation, ${scheme}`, ({
      page,
    }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            page.setViewportSize({ height: 900, width: NARROWEST })
          );

          yield* Effect.promise(() =>
            page.emulateMedia({ colorScheme: scheme })
          );

          yield* Effect.promise(() => page.goto(at("/")));

          expect(yield* sideways(page)).toBe(0);
          expect(yield* axeOn(page)).toStrictEqual([]);
        })
      ));
  }
});
