/**
 * A web import, as a browser does it: signed in, `/import?url=<repo>`
 * fills the form (owner and name from the URL), Import runs it, the page
 * says "Importing…" while the platform clones, and lands on the project's
 * page, which names where it was imported from. Saved as
 * `e2e/out/import.png`.
 *
 * It runs only when `WEB_IMPORT_URL` names a tiny public repo to import
 * (an HTTPS clone URL) and `WEB_URL` a web's origin, and is skipped
 * otherwise. It signs in with `WEB_SESSION`, a session token for the
 * stage, or, without one, through the dev world's own `/auth/dev` as
 * `WEB_IMPORT_AS` (oscabriel unless given). `WEB_IMPORT_NAME` names the
 * project instead of the URL's last segment, so a second run does not meet
 * `ProjectExists`. It writes: each run makes a project.
 */
import { expect, test } from "@playwright/test";
import { Config, Effect, Option, Redacted } from "effect";

const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
      as: yield* Config.NonEmptyString("WEB_IMPORT_AS").pipe(
        Config.withDefault("oscabriel")
      ),
      name: yield* Config.option(Config.NonEmptyString("WEB_IMPORT_NAME")),
      repo: yield* Config.option(Config.NonEmptyString("WEB_IMPORT_URL")),
      session: yield* Config.option(Config.Redacted("WEB_SESSION")),
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

/** Where the screenshot goes: `e2e/out/import.png`. */
const out = decodeURIComponent(new URL("out/", import.meta.url).pathname);

/** An import clones the repo: up to half a minute, and some margin. */
const IMPORTING = 90_000;

test.describe("a web import", () => {
  test.skip(
    Option.isNone(settings.repo) || Option.isNone(settings.web),
    "WEB_IMPORT_URL and WEB_URL are not both set: name a tiny public repo and a web's origin to run this check"
  );

  test.setTimeout(IMPORTING + 30_000);

  test("imports a public repo from /import and lands on its project", ({
    context,
    page,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const web = Option.getOrElse(settings.web, () => "");
        const repo = Option.getOrElse(settings.repo, () => "");

        yield* Option.match(settings.session, {
          onNone: () =>
            Effect.promise(() =>
              page.goto(`${web}/auth/dev?handle=${settings.as}`)
            ),
          onSome: (token) =>
            Effect.promise(() =>
              context.addCookies([
                {
                  name: "__Host-session",
                  secure: true,
                  url: web,
                  value: Redacted.value(token),
                },
              ])
            ),
        });

        yield* Effect.promise(() =>
          page.goto(`${web}/import?${new URLSearchParams({ url: repo })}`)
        );

        const form = page.getByRole("form", { name: "Import a repo" });

        yield* Effect.promise(() =>
          expect(form.getByLabel("Repo URL")).toHaveValue(repo)
        );

        const { name } = settings;

        if (Option.isSome(name)) {
          yield* Effect.promise(() => form.getByLabel("Name").fill(name.value));
        }

        yield* Effect.promise(() =>
          form.getByRole("button", { name: "Import" }).click()
        );

        yield* Effect.promise(() =>
          expect(form.getByRole("button", { name: "Importing…" })).toBeVisible()
        );

        yield* Effect.promise(() =>
          page.waitForURL((url) => url.pathname !== "/import", {
            timeout: IMPORTING,
          })
        );

        yield* Effect.promise(() =>
          expect(page.getByText(repo).first()).toBeVisible()
        );

        yield* Effect.promise(() =>
          page.screenshot({ fullPage: true, path: `${out}import.png` })
        );
      })
    ));
});
