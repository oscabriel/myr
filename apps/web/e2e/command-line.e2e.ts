/**
 * The command line's layout, as a browser lays it out: a word never breaks
 * while its row has room for it, on a phone or a desk. A line's first row
 * has the box's whole width; a row the column breaks off hangs, and has the
 * box's width less the hang (a URL longer than that still breaks,
 * anywhere). A short command once broke its own words (`<cli> today` read
 * "tod" / "<cli> ay"): its box hugged the line, and the 6ch hang left its
 * last word too little room.
 *
 * It runs only against `WEB_URL` (a stage's web origin, or a `vite dev`
 * with the dev fixtures) and is skipped without it. It only reads, signed
 * out.
 */
import { expect, test } from "@playwright/test";
import { Config, Effect, Option } from "effect";

/** Where the web lives. */
const web = Effect.runSync(
  Config.option(Config.NonEmptyString("WEB_URL")).pipe(
    Effect.map(Option.map((url) => url.replace(/\/+$/u, "")))
  )
);

/** Pages that show command lines to a reader who is not signed in. */
const PAGES = ["/today", "/home", "/agents"];

const WIDTHS = [390, 1280];

test.describe("the command line", () => {
  test.skip(
    Option.isNone(web),
    "WEB_URL is not set: point it at a web's origin to run this check"
  );

  for (const width of WIDTHS) {
    test(`breaks no word that fits its line, at ${width} px`, ({
      page: browser,
    }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const origin = Option.getOrElse(web, () => "");

          yield* Effect.promise(() =>
            browser.setViewportSize({ height: 900, width })
          );

          const broken = yield* Effect.forEach(PAGES, (path) =>
            Effect.gen(function* () {
              yield* Effect.promise(() => browser.goto(`${origin}${path}`));

              yield* Effect.promise(() =>
                expect(browser.locator("code.select-all").first()).toBeVisible()
              );

              // Each word's own width, set on one row, against its row's
              // room: a word that fits and still takes two rows is broken.
              const words = yield* Effect.promise(() =>
                browser.$$eval("code.select-all span.inline-block", (spans) =>
                  spans.map((span) => {
                    const line = span.parentElement ?? span;
                    const bounds = line.getBoundingClientRect();

                    const hang = Number(
                      getComputedStyle(line).paddingLeft.replace("px", "")
                    );

                    const word = span.getBoundingClientRect();

                    // Its own width on one row: set it so, read it, set it back.
                    span.style.whiteSpace = "pre";
                    span.style.maxWidth = "none";
                    const natural = span.getBoundingClientRect().width;
                    span.style.whiteSpace = "";
                    span.style.maxWidth = "";

                    return {
                      natural,
                      room:
                        bounds.width -
                        hang +
                        (Math.abs(word.top - bounds.top) < 1 ? hang : 0),
                      rows: Math.round(
                        word.height /
                          Number(
                            getComputedStyle(line).lineHeight.replace("px", "")
                          )
                      ),
                      word: span.textContent,
                    };
                  })
                )
              );

              return words.flatMap(({ natural, room, rows, word }) =>
                natural <= room && rows > 1 ? [`${path}: ${word}`] : []
              );
            })
          );

          expect(broken.flat()).toStrictEqual([]);
        })
      ));
  }
});
