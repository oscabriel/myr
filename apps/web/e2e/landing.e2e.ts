/**
 * The landing as a first-time reader meets it in a browser: its first action
 * takes them to the open asks, and axe finds no serious or critical
 * violation on it at a desk's width or a phone's, in either scheme, with
 * nothing scrolling sideways.
 *
 * It runs only against `WEB_URL` (a stage's web origin, or a `vite dev`
 * with the dev fixtures) and is skipped without it. It only reads, signed
 * out.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Config, Effect, Option, Schema } from "effect";

/** Where the web lives. */
const web = Effect.runSync(
  Config.option(Config.NonEmptyString("WEB_URL")).pipe(
    Effect.map(Option.map((url) => url.replace(/\/+$/u, "")))
  )
);

/** axe-core, from cdnjs, at the version `a11y.e2e.ts` runs. */
const AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";

/** What axe's `run` resolves to, as much of it as this check reads. */
const AxeRun = Schema.Struct({
  violations: Schema.Array(
    Schema.Struct({ id: Schema.String, impact: Schema.NullOr(Schema.String) })
  ),
});

const decodeAxeRun = Schema.decodeUnknownEffect(AxeRun);

/** axe's serious and critical violations on the page, by rule. */
const axeOn = (page: Page) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => page.addScriptTag({ url: AXE }));

    // axe's results come from the page: decoded here, as any outside input.
    const raw: unknown = yield* Effect.promise(() =>
      page.evaluate("axe.run()")
    );

    const { violations } = yield* Effect.orDie(decodeAxeRun(raw));

    return violations.flatMap(({ id, impact }) =>
      impact === "serious" || impact === "critical" ? [`${impact} ${id}`] : []
    );
  });

test.describe("the landing", () => {
  test.skip(
    Option.isNone(web),
    "WEB_URL is not set: point it at a web's origin to run this check"
  );

  test("leads to the open asks", ({ page }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const origin = Option.getOrElse(web, () => "");

        yield* Effect.promise(() => page.goto(`${origin}/`));

        yield* Effect.promise(() =>
          page.getByRole("link", { name: "See the open asks" }).click()
        );

        yield* Effect.promise(() => page.waitForURL(`${origin}/asks`));

        yield* Effect.promise(() =>
          expect(
            page.getByRole("heading", { level: 1, name: "Open asks" })
          ).toBeVisible()
        );
      })
    ));

  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`has no serious violation and no sideways scroll at ${width} px, ${scheme}`, ({
        page,
      }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const origin = Option.getOrElse(web, () => "");

            yield* Effect.promise(() =>
              page.setViewportSize({ height: 900, width })
            );

            yield* Effect.promise(() =>
              page.emulateMedia({ colorScheme: scheme })
            );

            yield* Effect.promise(() => page.goto(`${origin}/`));

            const sideways = yield* Effect.promise(() =>
              page.evaluate(
                () =>
                  document.documentElement.scrollWidth -
                  document.documentElement.clientWidth
              )
            );

            expect(sideways).toBe(0);
            expect(yield* axeOn(page)).toStrictEqual([]);
          })
        ));
    }
  }
});
