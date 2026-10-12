import { describe, expect, it } from "@effect/vitest";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import { Projects } from "@repo/project/projects";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { Effect, Layer, Option } from "effect";

import {
  ACCOUNT_PATHS,
  addEmailPage,
  codePage,
  problemPage,
  profilePage,
  resetPage,
  signInPage,
  signUpPage,
} from "../src/auth/pages.ts";
import type { Asker, PendingForm } from "../src/auth/pages.ts";
import { homeResponse } from "../src/home.ts";
import { HostInfo } from "../src/host-info.ts";

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
            project: ProjectName.make("alice/datekit"),
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
  "Google's profile page": profilePage(
    local,
    form,
    "/authorize?x=1",
    { displayName: "Carol Example", handle: "carol" },
    "That handle is taken. Choose another, or sign in."
  ),
  "adding an email": addEmailPage(
    claude,
    form,
    "/authorize?x=1",
    "alice@mail.example",
    "Another account already uses that email. Add a different one."
  ),
  "entering a code": codePage(
    claude,
    form,
    {
      action: ACCOUNT_PATHS.signUpVerify,
      intro: "We mailed a code to alice@mail.example.",
      newPassword: false,
      startOverHref: "/authorize?x=1",
    },
    "That code is wrong or has expired."
  ),
  "resetting a password": resetPage(
    local,
    form,
    "/authorize?x=1",
    "alice@mail.example"
  ),
  "setting a new password by code": codePage(local, form, {
    action: ACCOUNT_PATHS.resetVerify,
    intro: "If an account uses alice@mail.example, we mailed it a code.",
    newPassword: true,
    startOverHref: "/authorize?x=1",
  }),
  "sign-in": signInPage(
    claude,
    form,
    { google: true },
    "The email, handle or password is wrong."
  ),
  "sign-up": signUpPage(
    local,
    form,
    "/authorize?x=1",
    { displayName: "Alice", email: "alice@mail.example", handle: "alice" },
    "A password is 12 to 256 characters."
  ),
  "the problem page": problemPage(
    "This sign-in page expired or was not opened here. Start signing in again from your app."
  ),
} as const;

const FORMS = new Set(
  Object.keys(PAGES).filter((name) => name !== "the problem page")
);

interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
  readonly dark: boolean;
}

const styleOf = (html: string) => {
  const styles = [...html.matchAll(/<style>(?<css>.*?)<\/style>/gsu)];

  expect(styles).toHaveLength(1);

  return styles[0]?.groups?.css ?? "";
};

const DEPTH: ReadonlyMap<string, number> = new Map([
  ["{", 1],
  ["}", -1],
]);

const DARK = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/u;

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

interface Resolved {
  readonly value: string | undefined;
  readonly fromDark: boolean;
}

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

const luminanceOf = (hex: string) => {
  const [r = 0, g = 0, b = 0] = channelsOf(hex).map((channel) => {
    const unit = channel / 255;

    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (one: string, other: string) => {
  const [light, dark] = [luminanceOf(one), luminanceOf(other)].toSorted(
    (a, b) => b - a
  );

  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

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

    it.effect("lets the keyboard reach a block that scrolls sideways", () =>
      Effect.gen(function* () {
        const html = yield* page.html;

        expect(html.match(/<pre\b[^>]*>/gu) ?? []).toStrictEqual(
          (html.match(/<pre\b[^>]*>/gu) ?? []).map(() => '<pre tabindex="0">')
        );
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
      /<p class="error" role="alert">The email, handle or password is wrong\.<\/p>/u
    );
    expect(PAGES["the problem page"]).not.toContain('class="error"');
    expect(PAGES["the problem page"]).toMatch(/<a href="\/">/u);
  });
});

describe("a sign-in form shown again", () => {
  it("escapes every value the person typed", () => {
    const typed = `"><script>alert(1)</script>`;

    const pages = [
      signUpPage(local, form, "/authorize", {
        displayName: typed,
        email: typed,
        handle: typed,
      }),
      profilePage(local, form, "/authorize", {
        displayName: typed,
        handle: typed,
      }),
      addEmailPage(local, form, "/authorize", typed),
      resetPage(local, form, "/authorize", typed),
    ];

    for (const html of pages) {
      expect(html).not.toContain("<script>");
      expect(html).toContain(
        `value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`
      );
    }
  });

  it("never fills in a password", () => {
    expect(
      signUpPage(local, form, "/authorize", { email: "alice@mail.example" })
    ).toMatch(/<input type="password" name="password" [^>]*required>/u);
  });
});

describe("the sign-in page's ways out", () => {
  it("links to resetting a password and to signing up, carrying the sealed request", () => {
    const html = signInPage(claude, form, { google: false });

    expect(html).toContain(
      `href="${ACCOUNT_PATHS.reset}?request=sealed-request"`
    );
    expect(html).toContain('href="/signup?request=sealed-request"');
    expect(html).toContain("Email or handle");
  });
});
