import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Brand } from "@repo/brand";
import { ProjectName } from "@repo/protocol/ids";
import { Config, Console, Effect, Option, Schema } from "effect";

interface Imported {
  readonly project: string;
  readonly readme: string;
  readonly dir: string;
  readonly entry: string;
  readonly file: string;
  readonly evaluated: boolean;
}

const imports: readonly Imported[] = [
  {
    dir: "tests/ui",
    entry: "tests/ui/chained-comparison.rs",
    evaluated: true,
    file: "src/error.rs",
    project: "anyhow",
    readme: "idiomatic error handling in Rust applications",
  },
  {
    dir: "source/core",
    entry: "source/core/Ky.ts",
    evaluated: true,
    file: "source/core/Ky.ts",
    project: "ky",
    readme: "Ky is a tiny and elegant HTTP client",
  },
  {
    dir: "internal/exit",
    entry: "internal/exit/exit.go",
    evaluated: false,
    file: "choose/choose.go",
    project: "gum",
    readme: "A tool for glamorous shell scripts",
  },
  {
    dir: "src/click",
    entry: "src/click/core.py",
    evaluated: false,
    file: "src/click/exceptions.py",
    project: "click",
    readme: "Click is a Python package",
  },
  {
    dir: ".github/workflows",
    entry: ".github/workflows/main.yml",
    evaluated: false,
    file: ".github/workflows/main.yml",
    project: "awesome",
    readme: "Programming Languages",
  },
  {
    dir: "packages/cli/src/commands/status/__tests__",
    entry: "packages/cli/src/commands/status/__tests__/status.test.ts",
    evaluated: true,
    file: "packages/cli/src/index.ts",
    project: "changesets",
    readme: "A tool to manage versioning and changelogs",
  },
  {
    dir: "tests/caveview",
    entry: "tests/caveview/glext.h",
    evaluated: false,
    file: "stb_divide.h",
    project: "stb",
    readme: "single-file public domain",
  },
  {
    dir: "3rd-party/nanosvg",
    entry: "3rd-party/nanosvg/README.md",
    evaluated: false,
    file: "main.c",
    project: "fuzzel",
    readme: "Fuzzel is a Wayland-native application launcher",
  },
];

interface Known {
  readonly project: string;
  readonly file: string;
  readonly readme: string;
}

const known: readonly Known[] = [
  { file: "package.json", project: "hono", readme: "README.md" },
  { file: "package.json", project: "express", readme: "Readme.md" },
  { file: "package.json", project: "fastify", readme: "README.md" },
  { file: "package.json", project: "zustand", readme: "README.md" },
  { file: "package.json", project: "immer", readme: "readme.md" },
  { file: "package.json", project: "nanoid", readme: "README.md" },
  { file: "package.json", project: "commander", readme: "Readme.md" },
  { file: "package.json", project: "execa", readme: "readme.md" },
  { file: "package.json", project: "chalk", readme: "readme.md" },
  { file: "package.json", project: "mitt", readme: "README.md" },
  { file: "package.json", project: "clsx", readme: "readme.md" },
  { file: "Cargo.toml", project: "ripgrep", readme: "README.md" },
  { file: "Cargo.toml", project: "serde", readme: "README.md" },
  { file: "Cargo.toml", project: "axum", readme: "README.md" },
  { file: "Cargo.toml", project: "fd", readme: "README.md" },
  { file: "Cargo.toml", project: "hyperfine", readme: "README.md" },
  { file: "go.mod", project: "bubbletea", readme: "README.md" },
  { file: "go.mod", project: "fzf", readme: "README.md" },
  { file: "go.mod", project: "cobra", readme: "README.md" },
  { file: "go.mod", project: "gin", readme: "README.md" },
  { file: "pyproject.toml", project: "requests", readme: "README.md" },
  { file: "pyproject.toml", project: "flask", readme: "README.md" },
  { file: "pyproject.toml", project: "httpx", readme: "README.md" },
  { file: "pyproject.toml", project: "typer", readme: "README.md" },
  { file: "pyproject.toml", project: "jinja", readme: "README.md" },
  { file: "lua.c", project: "lua", readme: "README.md" },
  { file: "Makefile.am", project: "jq", readme: "README.md" },
  { file: "Makefile", project: "kilo", readme: "README.md" },
  { file: "Gemfile", project: "sinatra", readme: "README.md" },
  { file: "package.json", project: "nvm", readme: "README.md" },
];

const settings = Effect.runSync(
  Effect.gen(function* () {
    return {
      only: yield* Config.option(Config.NonEmptyString("WEB_IMPORTS")),
      web: Option.map(
        yield* Config.option(Config.NonEmptyString("WEB_URL")),
        (url) => url.replace(/\/+$/u, "")
      ),
    };
  })
);

const nameOf = (spelled: string): ProjectName =>
  Schema.decodeSync(ProjectName)(spelled);

const escaped = (text: string) =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const homeOf = (project: string) => `/${nameOf(project)}`;

const visitedOf = <A extends { readonly project: string }>(
  all: readonly A[]
): readonly A[] =>
  Option.match(settings.only, {
    onNone: () => all,
    onSome: (names) => {
      const named = new Set(
        names.split(",").map((name) => nameOf(name.trim()))
      );

      return all.filter(({ project }) => named.has(nameOf(project)));
    },
  });

const visited = visitedOf(imports);

const out = decodeURIComponent(
  new URL("out/imports/", import.meta.url).pathname
);

const UNREACHABLE = "The platform did not answer";

const NOT_BUILT = "not built";

const CRASHED = "Something went wrong";

const at = (path: string) =>
  `${Option.getOrElse(settings.web, () => "")}${path}`;

const awaited = <A>(promise: () => Promise<A>) => Effect.promise(promise);

const whole = (browser: Page) =>
  Effect.forEach(
    [UNREACHABLE, NOT_BUILT, CRASHED],
    (text) => awaited(() => expect(browser.getByText(text)).toHaveCount(0)),
    { discard: true }
  );

const shoot = (browser: Page, project: string, shot: string) =>
  awaited(() =>
    browser.screenshot({
      fullPage: true,
      path: `${out}${project}/${shot}.png`,
    })
  );

const visit = (
  browser: Page,
  project: string,
  path: string,
  shot: string,
  wanted: {
    readonly texts?: readonly string[];
    readonly selectors?: readonly string[];
  }
) =>
  Effect.gen(function* () {
    const response = yield* awaited(() => browser.goto(at(path)));

    expect(response?.status()).toBe(200);

    yield* Effect.forEach(
      wanted.texts ?? [],
      (text) =>
        awaited(() => expect(browser.getByText(text).first()).toBeVisible()),
      { discard: true }
    );

    yield* Effect.forEach(
      wanted.selectors ?? [],
      (selector) =>
        awaited(() => expect(browser.locator(selector).first()).toBeVisible()),
      { discard: true }
    );

    yield* whole(browser);
    yield* shoot(browser, project, shot);
  });

const timed = (
  browser: Page,
  project: string,
  path: string,
  shot: string,
  selector: string
) =>
  Effect.gen(function* () {
    const started = performance.now();

    const response = yield* awaited(() =>
      browser.goto(at(path), { timeout: 120_000, waitUntil: "networkidle" })
    );

    expect(response?.status()).toBe(200);

    yield* awaited(() =>
      expect(browser.locator(selector).first()).toBeVisible({
        timeout: 120_000,
      })
    );

    const took = Math.round(performance.now() - started);
    const said = `${project} ${path}: ${took} ms`;

    test.info().annotations.push({ description: said, type: "first view" });
    yield* Console.log(`first view: ${said}`);

    yield* whole(browser);
    yield* shoot(browser, project, shot);
  });

const loaded = (browser: Page, selector: string) =>
  awaited(() =>
    expect
      .poll(() =>
        browser
          .locator(selector)
          .first()
          .evaluate((image) =>
            image instanceof HTMLImageElement ? image.naturalWidth : 0
          )
      )
      .toBeGreaterThan(0)
  );

const newestCommit = (browser: Page, project: string) =>
  Effect.gen(function* () {
    const response = yield* awaited(() =>
      browser.goto(at(`${homeOf(project)}/commits/main`))
    );

    expect(response?.status()).toBe(200);

    const link = browser
      .locator(`a[href^="${homeOf(project)}/commit/"]`)
      .first();

    yield* awaited(() => expect(link).toBeVisible());

    const href = yield* awaited(() => link.getAttribute("href"));

    expect(href).toMatch(/\/commit\/[0-9a-f]{40}$/u);

    return href ?? "";
  });

const homeWanted = (project: string, readme: string) => ({
  selectors: [
    "[data-readme]",
    `section[aria-label="Take part"]:visible:has-text("${homeOf(project)}.git")`,
  ],
  texts: [readme],
});

const pages = ({ dir, entry, evaluated, file, project, readme }: Imported) => {
  const timedProject = project === "changesets" || project === "click";

  test(`${project}'s home renders its README and the clone box`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      visit(
        browser,
        project,
        homeOf(project),
        "home",
        homeWanted(project, readme)
      )
    ));

  test(`${project}'s ${dir} lists its entries`, ({ page: browser }) =>
    Effect.runPromise(
      timedProject
        ? timed(
            browser,
            project,
            `${homeOf(project)}/tree/main/${dir}`,
            "tree",
            `[data-entry="${entry}"]`
          )
        : visit(
            browser,
            project,
            `${homeOf(project)}/tree/main/${dir}`,
            "tree",
            {
              selectors: [`[data-entry="${entry}"]`],
            }
          )
    ));

  test(`${project}'s ${file} opens at line 5`, ({ page: browser }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* visit(
          browser,
          project,
          `${homeOf(project)}/blob/main/${file}#L5`,
          "blob",
          {
            selectors: ['[data-toolbar="file"]'],
            texts: ["Permalink"],
          }
        );

        expect(new URL(browser.url()).hash).toBe("#L5");
      })
    ));

  test(`${project}'s log groups its commits by day`, ({ page: browser }) =>
    Effect.runPromise(
      visit(browser, project, `${homeOf(project)}/commits/main`, "commits", {
        selectors: [`a[href^="${homeOf(project)}/commit/"]`, "[data-day]"],
        texts: ["Landings"],
      })
    ));

  test(`${project}'s newest commit shows what it changed`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const href = yield* newestCommit(browser, project);

        yield* visit(browser, project, href, "commit", {
          texts: ["changed"],
        });

        // A source's own commit may change nothing (gum's newest is a
        // version bump); any other shows each file it changed.
        const empty = yield* awaited(() =>
          browser.getByText(/^0 files changed/u).count()
        );

        if (empty === 0) {
          yield* awaited(() =>
            expect(browser.locator("[data-diffs-header]").first()).toBeVisible()
          );
        }
      })
    ));

  test(`${project}'s refs show main and its tags`, ({ page: browser }) =>
    Effect.runPromise(
      visit(browser, project, `${homeOf(project)}/refs`, "refs", {
        selectors: ['[data-ref="main"]'],
        texts: ["Landed at", "Tags"],
      })
    ));

  test(`${project}'s policy page shows ${evaluated ? "the defaults policy" : "that its policy is not evaluated"}`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      visit(
        browser,
        project,
        `${homeOf(project)}/policy`,
        "policy",
        evaluated
          ? { selectors: ['[data-paths="**"]'] }
          : {
              texts: [
                "has not been evaluated",
                `the project has no ${Brand.configDir}/ folder`,
              ],
            }
      )
    ));

  test(`${project}'s ${file} says why each line is there`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      timedProject
        ? timed(
            browser,
            project,
            `${homeOf(project)}/why/main/${file}`,
            "why",
            "[data-range]"
          )
        : visit(
            browser,
            project,
            `${homeOf(project)}/why/main/${file}`,
            "why",
            {
              selectors: ["[data-range]"],
            }
          )
    ));

  if (timedProject) {
    test(`${project}'s ${file} history lists the commits that changed it`, ({
      page: browser,
    }) =>
      Effect.runPromise(
        timed(
          browser,
          project,
          `${homeOf(project)}/commits/main?path=${encodeURIComponent(file)}`,
          "commits-path",
          `a[href^="${homeOf(project)}/commit/"]`
        )
      ));
  }
};

const knownPages = ({ file, project, readme }: Known) => {
  test(`${project}'s home renders its ${readme}`, ({ page: browser }) =>
    Effect.runPromise(
      visit(
        browser,
        project,
        homeOf(project),
        "home",
        homeWanted(project, readme)
      )
    ));

  test(`${project}'s root lists ${file}`, ({ page: browser }) =>
    Effect.runPromise(
      visit(browser, project, `${homeOf(project)}/tree/main`, "tree", {
        selectors: [`[data-entry="${file}"]`],
      })
    ));

  test(`${project}'s ${file} opens at line 5`, ({ page: browser }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* visit(
          browser,
          project,
          `${homeOf(project)}/blob/main/${file}#L5`,
          "blob",
          {
            selectors: ['[data-toolbar="file"]'],
          }
        );

        expect(new URL(browser.url()).hash).toBe("#L5");
      })
    ));

  test(`${project}'s log groups its commits by day`, ({ page: browser }) =>
    Effect.runPromise(
      visit(browser, project, `${homeOf(project)}/commits/main`, "commits", {
        selectors: [`a[href^="${homeOf(project)}/commit/"]`, "[data-day]"],
      })
    ));

  test(`${project}'s ${file} says why each line is there`, ({
    page: browser,
  }) =>
    Effect.runPromise(
      visit(browser, project, `${homeOf(project)}/why/main/${file}`, "why", {
        selectors: ["[data-range]"],
      })
    ));
};

const specifics = new Map<string, (browser: Page) => Effect.Effect<void>>([
  [
    "anyhow",
    (browser) =>
      Effect.gen(function* () {
        yield* visit(
          browser,
          "anyhow",
          `${homeOf("anyhow")}/refs?from=100`,
          "refs-tags",
          {
            selectors: ['[data-tag="1.0.0"]'],
          }
        );

        const tagged = browser.locator('[data-tag="1.0.0"] a').first();

        expect(yield* awaited(() => tagged.getAttribute("href"))).toBe(
          `${homeOf("anyhow")}/tree/1.0.0`
        );

        yield* visit(
          browser,
          "anyhow",
          `${homeOf("anyhow")}/tree/1.0.0`,
          "tag-tree",
          {
            selectors: ['[data-entry="Cargo.toml"]'],
          }
        );
      }),
  ],
  [
    "awesome",
    (browser) =>
      Effect.gen(function* () {
        yield* visit(browser, "awesome", homeOf("awesome"), "readme-links", {
          texts: ["Contribution guide", "Front-End Development"],
        });

        const href = yield* awaited(() =>
          browser
            .locator("[data-readme] a", { hasText: "Contribution guide" })
            .first()
            .getAttribute("href")
        );

        expect(href).toMatch(
          new RegExp(
            `^${escaped(homeOf("awesome"))}/blob/[0-9a-f]{40}/contributing\\.md$`,
            "u"
          )
        );
      }),
  ],
  [
    "changesets",
    (browser) =>
      Effect.gen(function* () {
        yield* visit(
          browser,
          "changesets",
          `${homeOf("changesets")}/blob/main/packages/cli/src/commands/status/__tests__/status.test.ts`,
          "deep-file",
          { texts: ["Permalink"] }
        );

        let from = 0;
        let found = false;

        while (!found && from < 1000) {
          yield* visit(
            browser,
            "changesets",
            from === 0
              ? `${homeOf("changesets")}/refs`
              : `${homeOf("changesets")}/refs?from=${from}`,
            "refs-scoped",
            { texts: ["Tags"] }
          );
          found =
            (yield* awaited(() =>
              browser.locator('[data-tag^="@changesets/cli@"]').count()
            )) > 0;
          from += found ? 0 : 100;
        }

        expect(found).toBe(true);

        const href = yield* awaited(() =>
          browser
            .locator('[data-tag^="@changesets/cli@"] a')
            .first()
            .getAttribute("href")
        );

        expect(href).toMatch(
          new RegExp(
            `^${escaped(homeOf("changesets"))}/tree/%40changesets%2Fcli%40`,
            "u"
          )
        );

        yield* visit(browser, "changesets", href ?? "", "scoped-tag-tree", {
          selectors: ['[data-entry="packages"]'],
        });
      }),
  ],
  [
    "click",
    (browser) =>
      Effect.gen(function* () {
        yield* visit(
          browser,
          "click",
          `${homeOf("click")}/commits/main`,
          "log-first",
          {
            texts: ["Older"],
          }
        );
        yield* awaited(() => browser.getByText("Older").first().click());
        yield* awaited(() => browser.waitForURL(/from=30/u));
        yield* awaited(() =>
          expect(
            browser.locator(`a[href^="${homeOf("click")}/commit/"]`).first()
          ).toBeVisible()
        );
        yield* whole(browser);
        yield* shoot(browser, "click", "log-older");
      }),
  ],
  [
    "fuzzel",
    (browser) =>
      Effect.gen(function* () {
        yield* visit(
          browser,
          "fuzzel",
          `${homeOf("fuzzel")}/tree/main/external`,
          "submodule",
          {
            selectors: ['[data-entry="external/wlr-protocols"]'],
          }
        );

        const row = browser.locator('[data-entry="external/wlr-protocols"]');

        yield* awaited(() => expect(row).toContainText("Submodule:"));
        yield* awaited(() => expect(row.locator("a")).toHaveCount(0));
      }),
  ],
  [
    "ky",
    (browser) =>
      Effect.gen(function* () {
        yield* visit(browser, "ky", homeOf("ky"), "readme-logo", {
          selectors: ['[data-readme="readme.md"]'],
        });

        const logo = `[data-readme] img[src^="${homeOf("ky")}/raw/"][src$="/media/logo.svg"]`;

        yield* loaded(browser, logo);
      }),
  ],
  [
    "stb",
    (browser) =>
      Effect.gen(function* () {
        yield* visit(
          browser,
          "stb",
          `${homeOf("stb")}/blob/main/tests/caveview/glext.h`,
          "large-file",
          { texts: ["glext.h"] }
        );

        yield* visit(
          browser,
          "stb",
          `${homeOf("stb")}/blob/main/data/easy_font_raw.png`,
          "png",
          {
            selectors: [`img[src^="${homeOf("stb")}/raw/"]`],
          }
        );
        yield* loaded(browser, `img[src^="${homeOf("stb")}/raw/"]`);
      }),
  ],
]);

test.describe("the imported repos", () => {
  test.skip(
    Option.isNone(settings.web),
    "WEB_URL is not set: point it at a dev stage's web origin to run this check"
  );

  // A first view of `why` walks up to 200 commits, one read each: 30 to
  // 55 s live on these repos, past Playwright's default minute with the
  // page's own reads.
  test.setTimeout(240_000);

  for (const imported of visited) {
    test.describe(nameOf(imported.project), () => {
      pages(imported);

      const specific = specifics.get(imported.project);

      if (specific !== undefined) {
        test(`${imported.project} renders what it was picked for`, ({
          page: browser,
        }) => Effect.runPromise(specific(browser)));
      }
    });
  }

  for (const imported of visitedOf(known)) {
    test.describe(nameOf(imported.project), () => {
      knownPages(imported);
    });
  }
});
