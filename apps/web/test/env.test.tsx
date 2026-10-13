import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import type { EnvItem } from "@repo/protocol/domain/env";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Ledger } from "@repo/protocol/domain/visibility";
import { isRedirect } from "@tanstack/react-router";
import { DateTime, Effect, Option, Schema } from "effect";

import { ProjectView } from "../src/features/project/project-page.tsx";
import {
  movedToEnvironment,
  movedToLedger,
} from "../src/features/visibility/moved.ts";
import { VisibilityView } from "../src/features/visibility/visibility-page.tsx";
import { Route as EnvRoute } from "../src/routes/$owner/$project/env.tsx";
import { Route as LedgerRoute } from "../src/routes/$owner/$project/ledger.tsx";
import { canonicalAddress } from "../src/server/addresses.ts";
import { inOrder, markupOf, plainText, textOf } from "./ask-fixtures.ts";
import { textIn } from "./markup.ts";
import { elementWith, factsOf, mainOf } from "./records.ts";
import { renderAt } from "./render.tsx";

const now = DateTime.makeUnsafe("2026-10-12T12:00:00Z");

const decodeView = Schema.decodeSync(EnvSchemaView);

const items: readonly (typeof EnvItem.Encoded)[] = [
  {
    key: "APP_ENV",
    required: true,
    sensitive: false,
    tags: [],
    type: "enum(development, test, production)",
  },
  {
    description: "Error reporting DSN. Public: it ships in builds.",
    key: "SENTRY_DSN",
    required: true,
    sensitive: false,
    tags: [],
    type: "url",
  },
  {
    description:
      "Source-map upload token. Release step only; never enters a check.",
    key: "SENTRY_AUTH_TOKEN",
    placeholder: "placeholder-sentry-auth-token",
    proxy: { domains: ["sentry.io"], path: "/api/**" },
    required: "depends",
    sensitive: true,
    tags: ["release"],
    value: { setAt: "2026-10-10T09:30:00.000Z", setBy: "ines-v" },
  },
  {
    description: "Where locale data lives.",
    key: "DATEKIT_LOCALE_DIR",
    required: true,
    sensitive: false,
    tags: [],
  },
];

const datekit = decodeView({
  at: "9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c",
  currentEnvKey: "APP_ENV",
  file: ".env.schema",
  imports: [],
  items,
  project: "datekit",
});

/** A docs entry that is a script, not an address; joined at run time, as lint refuses it written out. */
const scriptAddress = ["javascript", "alert(1)"].join(":");

const ledger = Schema.decodeSync(Ledger)({
  entries: [],
  layers: [],
  posture: "open",
  postureLabel: "Open",
  project: "datekit",
});

/** The Visibility tab as an environment test reads it, beside a ledger with nothing held back. */
const tabWith = (
  schema: EnvSchemaView | undefined,
  at: DateTime.Utc = now
) => <VisibilityView env={schema} ledger={ledger} now={at} />;

const page = tabWith(datekit);

const environmentOf = (markup: string) =>
  elementWith(markup, 'aria-labelledby="environment"');

const itemOf = (markup: string, key: string) => {
  const start = markup.indexOf(`data-env-key="${key}"`);
  const next = markup.indexOf("data-env-key=", start + 1);

  return start === -1
    ? ""
    : markup.slice(start, next === -1 ? undefined : next);
};

const keysOf = (markup: string) =>
  [...mainOf(markup).matchAll(/data-env-key="(?<key>[^"]*)"/gu)].map(
    (found) => found.groups?.key
  );

describe("a project's environment", () => {
  it("is titled Environment, and its status line counts the items and says who set the sensitive one", () => {
    const markup = markupOf(page);

    expect(environmentOf(markup)).toMatch(
      /<h2\b[^>]*id="environment"[^>]*>Environment<\/h2>/u
    );
    expect(textIn(elementWith(markup, "data-env-status")).trim()).toBe(
      "4 items · 1 sensitive, set by ines-v 2 d ago"
    );
  });

  it("lists the sensitive item first, whatever its place in the schema, then the rest in the schema's order", () => {
    expect(keysOf(markupOf(page))).toStrictEqual([
      "SENTRY_AUTH_TOKEN",
      "APP_ENV",
      "SENTRY_DSN",
      "DATEKIT_LOCALE_DIR",
    ]);
  });

  it("says on the sensitive item's own line that it is sensitive and who set it, then its facts", () => {
    const item = itemOf(mainOf(markupOf(page)), "SENTRY_AUTH_TOKEN");
    const line = elementWith(item, "data-env-line");

    expect(item).toContain('data-sensitive="true"');
    expect(
      inOrder(plainText(line), [
        "SENTRY_AUTH_TOKEN",
        "sensitive",
        "set by ines-v",
        "2 d ago",
      ])
    ).toBeTruthy();
    expect(elementWith(line, "data-env-sensitive")).toMatch(/text-sealed/u);
    expect(
      inOrder(plainText(item), [
        "Source-map upload token.",
        "Required",
        "depends on environment",
        "Proxy",
        "sentry.io",
        "only",
        "/api/**",
        "Tags",
        "release",
      ])
    ).toBeTruthy();
  });

  it("never says a value was set in the future, though it was set after the page was read", () => {
    // Served at 09:00; ines-v set the value at 09:30 while the page stayed open.
    const item = itemOf(
      mainOf(
        markupOf(
          tabWith(datekit, DateTime.makeUnsafe("2026-10-10T09:00:00Z"))
        )
      ),
      "SENTRY_AUTH_TOKEN"
    );

    expect(item).toMatch(/<time\b[^>]*>now<\/time>/u);
    expect(item).not.toMatch(/>in \d+ (?:min|h|d)</u);
  });

  it("shows every item's name, type and description", () => {
    const text = plainText(mainOf(markupOf(page)));

    expect(
      inOrder(text, [
        "APP_ENV",
        "enum(development, test, production)",
        "SENTRY_DSN",
        "Error reporting DSN.",
        "url",
        "DATEKIT_LOCALE_DIR",
        "Where locale data lives.",
      ])
    ).toBeTruthy();
  });

  it("credits the format to varlock, linked, and says no value is shown", () => {
    const region = environmentOf(markupOf(page));

    expect(
      inOrder(plainText(region), [
        "Declared in",
        "varlock's .env.schema format",
        "Values are never shown.",
      ])
    ).toBeTruthy();
    expect(region).toMatch(/<a\b[^>]*href="https:\/\/varlock\.dev"/u);
  });

  it("says where it was read: the file, the landed commit and the environment", () => {
    const facts = environmentOf(markupOf(page));

    expect(
      inOrder(plainText(facts), [
        "Where it was read",
        ".env.schema",
        "9b1c3e5",
        "APP_ENV",
      ])
    ).toBeTruthy();
    expect(facts).toContain(
      'href="/oscabriel/datekit/commit/9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c"'
    );
  });

  it("shows no value and no control to set or read one, only the CLI line, numbered", () => {
    const markup = markupOf(page);

    for (const control of ["<input", "<textarea", "<form", "<select"]) {
      expect(markup).not.toContain(control);
    }

    expect(markup).not.toMatch(/reveal|show value/iu);
    // The placeholder unlanded code sees is not a value, but reads like one.
    expect(markup).not.toContain("placeholder-sentry-auth-token");
    expect(plainText(environmentOf(markup))).toContain(
      `${Brand.cli} env set <KEY> --project oscabriel/datekit --yes`
    );
  });

  it("shows the posture the project's own ledger gives in its facts", () => {
    const layered = markupOf(
      <VisibilityView
        env={datekit}
        ledger={{ ...ledger, posture: "openCore", postureLabel: "Open core" }}
        now={now}
      />
    );

    expect(factsOf(layered)).toContain('data-posture="openCore"');
    expect(factsOf(markupOf(page))).toContain('data-posture="open"');
  });

  it("says a sensitive item nobody set is not set", () => {
    const unset = decodeView({
      ...Schema.encodeSync(EnvSchemaView)(datekit),
      items: items.map(({ value: _value, ...item }) => item),
    });

    const markup = markupOf(tabWith(unset));
    const item = itemOf(mainOf(markup), "SENTRY_AUTH_TOKEN");

    expect(item).toContain("not set");
    expect(item).not.toContain("set by");
    expect(textIn(elementWith(markup, "data-env-status")).trim()).toBe(
      "4 items · 1 sensitive, not set"
    );
  });

  it("links an item's docs only when they are a web address, and marks it deprecated", () => {
    const view = decodeView({
      ...Schema.encodeSync(EnvSchemaView)(datekit),
      items: [
        {
          deprecated: true,
          docs: "https://docs.example.invalid/locales",
          key: "OLD_LOCALE_DIR",
          required: false,
          sensitive: false,
          tags: [],
        },
        {
          docs: scriptAddress,
          key: "ODD_DOCS",
          required: false,
          sensitive: false,
          tags: [],
        },
      ],
    });

    const markup = mainOf(markupOf(tabWith(view)));

    expect(itemOf(markup, "OLD_LOCALE_DIR")).toContain(
      'href="https://docs.example.invalid/locales"'
    );
    expect(itemOf(markup, "OLD_LOCALE_DIR")).toContain("Deprecated");
    expect(markup).not.toContain(`href="${scriptAddress}`);
    expect(itemOf(markup, "ODD_DOCS")).toContain(scriptAddress);
  });

  it("says plainly when the landed schema declares no items", () => {
    const empty = decodeView({
      ...Schema.encodeSync(EnvSchemaView)(datekit),
      items: [],
    });

    expect(textOf(tabWith(empty))).toContain(
      "No env items"
    );
  });

  it.effect("sits under the project's crumbs: datekit, then Visibility", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt("/oscabriel/datekit/visibility", page);
      const crumbs = elementWith(markup, 'aria-label="Breadcrumb"');

      expect(crumbs).toMatch(
        /<a\b[^>]*href="\/oscabriel\/datekit"[^>]*>oscabriel\/datekit<\/a>/u
      );
      expect(plainText(crumbs)).toContain("Visibility");
    })
  );
});

describe("a project with nothing landed", () => {
  it("says it has no environment yet, rather than that it is unknown, with the command to read it", () => {
    const view = tabWith(undefined);
    const text = plainText(environmentOf(markupOf(view)));

    expect(markupOf(view)).toMatch(/<h1\b[^>]*>Visibility<\/h1>/u);
    expect(text).toContain("Nothing has landed in oscabriel/datekit yet");
    expect(text).toContain(
      `${Brand.cli} env shape --project oscabriel/datekit`
    );
    expect(text).not.toContain("UnknownProject");
  });
});

describe("the environment's way in", () => {
  it("is linked from the project's page", () => {
    const listing = Schema.decodeSync(ProjectListing)({
      landedAt: "2026-10-11T09:00:00.000Z",
      openAsks: 0,
      posture: "open",
      project: "datekit",
    });

    const markup = markupOf(
      <ProjectView
        asks={[]}
        landings={[]}
        listing={listing}
        now={now}
        platformUrl="https://platform-test.example.workers.dev"
      />
    );

    expect(markup).toMatch(
      /<a\b[^>]*href="\/oscabriel\/datekit\/visibility#environment"[^>]*>Environment<\/a>/u
    );
  });
});

const WEB_URL = "https://web-test.example.workers.dev";

const movedTo = (path: string) =>
  Option.map(canonicalAddress(new Request(`${WEB_URL}${path}`)), (response) => [
    response.status,
    response.headers.get("location"),
  ]);

const sentOnFrom = (
  moved: typeof movedToEnvironment,
  project: string,
  searchStr = ""
) =>
  Effect.tryPromise({
    catch: (thrown) =>
      isRedirect(thrown)
        ? [thrown.status, thrown.headers.get("location")]
        : ["not a redirect"],
    try: () => moved({ location: { searchStr }, params: { project } }),
  }).pipe(Effect.flip);

describe("the old Env shape and Ledger addresses", () => {
  it("are a 301 to the Visibility tab, at its Environment and its Ledger, the query kept", () => {
    expect(movedTo("/oscabriel/datekit/env")).toStrictEqual(
      Option.some([301, "/oscabriel/datekit/visibility#environment"])
    );
    expect(movedTo("/oscabriel/datekit/ledger?x=1")).toStrictEqual(
      Option.some([301, "/oscabriel/datekit/visibility?x=1#ledger"])
    );
  });

  it("take an old or miscased name to the tab in one move", () => {
    expect(movedTo("/datekit/env")).toStrictEqual(
      Option.some([301, "/oscabriel/datekit/visibility#environment"])
    );
    expect(movedTo("/GitHub.com/Pallets/click/ledger")).toStrictEqual(
      Option.some([301, "/github.com/pallets/click/visibility#ledger"])
    );
  });

  it("move only the page itself, never a path below it", () => {
    expect(movedTo("/oscabriel/datekit/env/extra")).toStrictEqual(
      Option.none()
    );
    expect(movedTo("/oscabriel/datekit/visibility")).toStrictEqual(
      Option.none()
    );
  });

  // The worker answers a document load with its 301; a page kept before the move may still link here.
  it.effect("send a navigation inside the app on to the tab", () =>
    Effect.gen(function* () {
      expect(EnvRoute.options.beforeLoad).toBe(movedToEnvironment);
      expect(LedgerRoute.options.beforeLoad).toBe(movedToLedger);
      expect(
        yield* sentOnFrom(movedToEnvironment, "oscabriel/datekit")
      ).toStrictEqual([301, "/oscabriel/datekit/visibility#environment"]);
      expect(
        yield* sentOnFrom(movedToLedger, "github.com/pallets/click", "?x=1")
      ).toStrictEqual([301, "/github.com/pallets/click/visibility?x=1#ledger"]);
    })
  );
});

const webSources: Readonly<Record<string, string>> = import.meta.glob(
  [
    "../src/**/*.{ts,tsx}",
    "!../src/**/*.gen.ts",
    "../../../packages/agent-kit/src/**/*.ts",
  ],
  { eager: true, import: "default", query: "?raw" }
);

describe("the Env shape label", () => {
  it("appears nowhere the web draws from: the page is Environment now", () => {
    expect(Object.keys(webSources).length).toBeGreaterThan(100);
    expect(
      Object.entries(webSources).flatMap(([path, source]) =>
        /Env shape/u.test(source) ? [path] : []
      )
    ).toStrictEqual([]);
  });
});
