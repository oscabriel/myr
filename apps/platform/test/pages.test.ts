/**
 * The platform's own HTML pages (sign-in, which is an MCP client's
 * consent, sign-up, Google's handle page, the problem page, and `/`) load
 * nothing, so each carries its look in one inline `<style>`. This reads
 * that style the way a browser would for each colour scheme and holds its
 * literal colours to WCAG's contrast floors in both: text and links at
 * 4.5:1, input borders at 3:1. The formulas are WCAG 2.2's own (relative
 * luminance over sRGB), written here.
 */
import { describe, expect, it } from "@effect/vitest";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { Projects } from "@repo/project/projects";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { Effect, Layer, Option } from "effect";

import {
  pickHandlePage,
  problemPage,
  signInPage,
  signUpPage,
} from "../src/auth/pages.ts";
import type { Asker, PendingForm } from "../src/auth/pages.ts";
import { homeResponse } from "../src/home.ts";
import { HostInfo } from "../src/host-info.ts";

// --- The pages, from stand-in inputs ------------------------------------------

const claude: Asker = {
  clientDomain: "claude.ai",
  clientName: "Claude",
  redirectHost: "claude.ai",
  redirectIsLoopback: false,
};

const local: Asker = {
  clientName: "A CLI",
  redirectHost: "127.0.0.1:53682",
  redirectIsLoopback: true,
};

const form: PendingForm = { csrf: "csrf-token", request: "sealed-request" };

const home = Effect.gen(function* () {
  const response = yield* homeResponse(
    new Request("https://platform.example/", {
      headers: { accept: "text/html" },
    })
  );

  return yield* Effect.promise(() => response.text());
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      FrontPageMemory.layer({
        credits: [],
        entries: [],
        projects: [
          {
            openAsks: 2,
            posture: "open",
            project: ProjectName.make("datekit"),
          },
        ],
      }),
      Layer.succeed(
        Projects,
        Projects.of({
          create: () => Effect.die("the home page makes no project"),
          get: (project) => Effect.fail(new UnknownProject({ project })),
        })
      ),
      Layer.succeed(
        HostInfo,
        HostInfo.of({
          draftModel: "@cf/test/drafter",
          webUrl: Option.some("https://web.example"),
        })
      )
    )
  )
);

const PAGES = {
  "Google's handle page": pickHandlePage(
    local,
    form,
    "/authorize?x=1",
    "That handle is taken. Choose another, or sign in."
  ),
  "sign-in": signInPage(
    claude,
    form,
    { google: true },
    "The handle or password is wrong."
  ),
  "sign-up": signUpPage(
    local,
    form,
    "/authorize?x=1",
    "A password is 12 to 256 characters."
  ),
  "the problem page": problemPage(
    "This sign-in page expired or was not opened here. Start signing in again from your app."
  ),
} as const;

/** The pages with a form: each input's border must be seen. */
const FORMS = new Set(["Google's handle page", "sign-in", "sign-up"]);

// --- Reading a style as a browser would ---------------------------------------

interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
  /** Whether it sits in the dark scheme's media query. */
  readonly dark: boolean;
}

/** The one inline style of a page. */
const styleOf = (html: string) => {
  const styles = [...html.matchAll(/<style>(?<css>.*?)<\/style>/gsu)];

  expect(styles).toHaveLength(1);

  return styles[0]?.groups?.css ?? "";
};

/** How a brace moves the depth of a rule. */
const DEPTH: ReadonlyMap<string, number> = new Map([
  ["{", 1],
  ["}", -1],
]);

const DARK = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/u;

/** Every rule of `css`, a dark-scheme media query's marked dark. */
const rulesOf = (css: string, dark = false): readonly Rule[] => {
  const rules: Rule[] = [];
  const text = css.replaceAll(/\/\*.*?\*\//gsu, "");
  let at = 0;

  while (at < text.length) {
    const open = text.indexOf("{", at);

    if (open === -1) {
      break;
    }

    const head = text.slice(at, open).trim();
    let depth = 1;
    let close = open + 1;

    while (depth > 0 && close < text.length) {
      depth += DEPTH.get(text[close] ?? "") ?? 0;
      close += 1;
    }

    const body = text.slice(open + 1, close - 1);

    if (head.startsWith("@media")) {
      rules.push(...(DARK.test(head) ? rulesOf(body, true) : []));
    } else {
      rules.push({
        dark,
        declarations: new Map(
          body
            .split(";")
            .map((declaration) => declaration.split(":"))
            .filter((parts) => parts.length >= 2)
            .map(([name = "", ...value]) => [
              name.trim(),
              value.join(":").trim(),
            ])
        ),
        selectors: head.split(",").map((selector) => selector.trim()),
      });
    }

    at = close;
  }

  return rules;
};

type Scheme = "dark" | "light";

/** A property's value as the scheme sets it, with whether the dark query set any of it. */
interface Resolved {
  readonly value: string | undefined;
  readonly fromDark: boolean;
}

/** `property` on `selector` in `scheme`: the last rule that sets it wins, and `var()` resolves on `:root`. */
const resolve = (
  rules: readonly Rule[],
  scheme: Scheme,
  selector: string,
  property: string
): Resolved => {
  const applying = rules.filter(
    (rule) =>
      (scheme === "dark" || !rule.dark) &&
      rule.selectors.includes(selector) &&
      rule.declarations.has(property)
  );

  const rule = applying.at(-1);
  const value = rule?.declarations.get(property);

  const variable = /^var\((?<name>--[\w-]+)\)$/u.exec(value ?? "")?.groups
    ?.name;

  if (variable === undefined) {
    return { fromDark: rule?.dark ?? false, value };
  }

  const inner = resolve(rules, scheme, ":root", variable);

  return {
    fromDark: (rule?.dark ?? false) || inner.fromDark,
    value: inner.value,
  };
};

/** `#rgb` or `#rrggbb` as its three channels, 0–255. */
const channelsOf = (hex: string) => {
  const digits = /^#(?<body>[\da-f]{3}|[\da-f]{6})$/iu.exec(hex)?.groups?.body;

  expect(digits, `${hex} is a literal hex colour`).toBeDefined();

  const full =
    digits?.length === 3
      ? digits.replaceAll(/(?<digit>.)/gu, "$<digit>$<digit>")
      : (digits ?? "000000");

  return [0, 2, 4].map((start) =>
    Number.parseInt(full.slice(start, start + 2), 16)
  );
};

/** WCAG 2.2's relative luminance of an sRGB colour. */
const luminanceOf = (hex: string) => {
  const [r = 0, g = 0, b = 0] = channelsOf(hex).map((channel) => {
    const unit = channel / 255;

    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.2's contrast ratio of two colours. */
const contrast = (one: string, other: string) => {
  const [light, dark] = [luminanceOf(one), luminanceOf(other)].toSorted(
    (a, b) => b - a
  );

  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

/** A colour the scheme sets: fails the test when it sets none. */
const colour = (
  rules: readonly Rule[],
  scheme: Scheme,
  selector: string,
  property: string
) => {
  const { value } = resolve(rules, scheme, selector, property);

  expect(value, `${selector} sets ${property} in ${scheme}`).toBeDefined();

  return value ?? "";
};

// --- The checks -----------------------------------------------------------------

/** Every floor, in one scheme, on one page's style. */
const holdsTheFloors = (
  rules: readonly Rule[],
  scheme: Scheme,
  hasForm: boolean
) => {
  const paper = colour(rules, scheme, "body", "background-color");

  const at = (selector: string, property = "color") =>
    contrast(colour(rules, scheme, selector, property), paper);

  expect(at("body"), "body text").toBeGreaterThanOrEqual(4.5);
  expect(at("a"), "links").toBeGreaterThanOrEqual(4.5);
  expect(at(".error"), "an error").toBeGreaterThanOrEqual(4.5);
  expect(at(".muted"), "muted text").toBeGreaterThanOrEqual(4.5);
  expect(at(".warn"), "the warning's word").toBeGreaterThanOrEqual(4.5);

  if (hasForm) {
    expect(at("input", "border-color"), "input borders").toBeGreaterThanOrEqual(
      3
    );
    expect(
      contrast(
        colour(rules, scheme, "input", "color"),
        colour(rules, scheme, "input", "background-color")
      ),
      "input text"
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(
        colour(rules, scheme, "button", "color"),
        colour(rules, scheme, "button", "background-color")
      ),
      "the primary button"
    ).toBeGreaterThanOrEqual(4.5);
  }
};

describe("the platform's own pages", () => {
  const each = [
    ...Object.entries(PAGES).map(([name, html]) => ({
      form: FORMS.has(name),
      html: Effect.succeed(html),
      name,
    })),
    { form: false, html: home, name: "the platform's /" },
  ];

  describe.each(each)("$name", (page) => {
    it.effect("loads nothing: no script, stylesheet, font or image", () =>
      Effect.gen(function* () {
        expect(yield* page.html).not.toMatch(
          /<script|<link|<img|src=|url\(|@import|@font-face/u
        );
      })
    );

    it.effect("follows the system's scheme and colours its links in both", () =>
      Effect.gen(function* () {
        const rules = rulesOf(styleOf(yield* page.html));

        expect(resolve(rules, "light", ":root", "color-scheme").value).toBe(
          "light dark"
        );
        expect(resolve(rules, "dark", "a", "color").fromDark).toBeTruthy();
        expect(
          resolve(rules, "dark", "body", "background-color").fromDark
        ).toBeTruthy();
      })
    );

    it.effect("holds every contrast floor in the light and dark schemes", () =>
      Effect.gen(function* () {
        const rules = rulesOf(styleOf(yield* page.html));

        holdsTheFloors(rules, "light", page.form);
        holdsTheFloors(rules, "dark", page.form);
      })
    );

    it.effect("reads at 16 px, inputs too", () =>
      Effect.gen(function* () {
        const rules = rulesOf(styleOf(yield* page.html));

        expect(resolve(rules, "light", "body", "font-size").value).toBe("16px");
        expect(resolve(rules, "light", "input", "font-size").value).toBe(
          "16px"
        );
      })
    );
  });
});

describe("the sign-in page, as an MCP client's consent", () => {
  it("says who asks and where access goes before Google and the form", () => {
    const html = PAGES["sign-in"];
    const asks = html.indexOf("asks to act as you");
    const goes = html.indexOf("Access goes to");
    const google = html.indexOf("Continue with Google");
    const formAt = html.indexOf("<form");

    expect(asks).toBeGreaterThan(html.indexOf("<h1"));
    expect(goes).toBeGreaterThan(asks);
    expect(google).toBeGreaterThan(goes);
    expect(formAt).toBeGreaterThan(google);
    expect(html.indexOf("New here?")).toBeGreaterThan(formAt);
  });

  it("puts the loopback warning in the consent, as a word, before the form", () => {
    const html = signInPage(local, form, { google: false });
    const warning = html.indexOf("Warning");

    expect(warning).toBeGreaterThan(html.indexOf("Access goes to"));
    expect(warning).toBeLessThan(html.indexOf("<form"));
    expect(html).toContain(
      "This sends access to an app on your computer. Continue only if you just started signing in from it."
    );
    expect(signInPage(claude, form, { google: false })).not.toContain(
      "Warning"
    );
  });

  it("escapes every value a client supplies", () => {
    const html = signInPage(
      {
        clientDomain: `"><img src=x>`,
        clientName: `<script>alert("x")</script>`,
        redirectHost: "evil.example<b>",
        redirectIsLoopback: false,
      },
      { csrf: `"><script>`, request: `a"b` },
      { google: true }
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("evil.example&lt;b&gt;");
  });

  it("draws an error in the refusal's colour, and the problem page's in ink", () => {
    expect(PAGES["sign-in"]).toMatch(
      /<p class="error" role="alert">The handle or password is wrong\.<\/p>/u
    );
    expect(PAGES["the problem page"]).not.toContain('class="error"');
    expect(PAGES["the problem page"]).toMatch(/<a href="\/">/u);
  });
});
