/**
 * A project's env shape, rendered to HTML with `react-dom/server` from
 * datekit's `.env.schema` as `envShape` returns it: each item's name,
 * description, type, whether it is required, whether it is sensitive, its
 * `@proxy` hosts, docs and deprecation; for a sensitive item who set its
 * value and when, never the value, and no control that would take or show
 * one. A caption credits the format to varlock.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import type { EnvItem } from "@repo/protocol/domain/env";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { DateTime, Schema } from "effect";

import { EnvView, NothingLanded } from "../src/features/env/env-page.tsx";
import { ProjectView } from "../src/features/project/project-page.tsx";
import { inOrder, markupOf, textOf } from "./ask-fixtures.ts";

const now = DateTime.makeUnsafe("2026-10-12T12:00:00Z");

const decodeView = Schema.decodeSync(EnvSchemaView);

/** datekit's items, encoded, as its `.env.schema` declares them. */
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

/** datekit's env shape at its landed SHA, as `envShape` returns it. */
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

const page = <EnvView now={now} schema={datekit} />;

/** The markup of the item `key`: from its row to the next item's. */
const itemOf = (markup: string, key: string) => {
  const start = markup.indexOf(`data-env-key="${key}"`);
  const next = markup.indexOf("data-env-key=", start + 1);

  return start === -1
    ? ""
    : markup.slice(start, next === -1 ? undefined : next);
};

describe("a project's env shape", () => {
  it("shows a sensitive item as sensitive, required by environment, with its proxy host and who set it", () => {
    const item = itemOf(markupOf(page), "SENTRY_AUTH_TOKEN");
    const text = textOf(page);

    expect(item).toContain('data-sensitive="true"');
    expect(
      inOrder(text, [
        "SENTRY_AUTH_TOKEN",
        "Source-map upload token.",
        "Required",
        "depends on environment",
        "Sensitive",
        "yes",
        "Proxy",
        "sentry.io",
        "Value",
        "set by ines-v",
        "2 d ago",
      ])
    ).toBeTruthy();
  });

  it("shows every item's name, type and description", () => {
    const text = textOf(page);

    expect(
      inOrder(text, [
        "APP_ENV",
        "enum(development, test, production)",
        "SENTRY_DSN",
        "Error reporting DSN.",
        "url",
        "SENTRY_AUTH_TOKEN",
        "DATEKIT_LOCALE_DIR",
        "Where locale data lives.",
      ])
    ).toBeTruthy();
  });

  it("credits the format to varlock", () => {
    expect(textOf(page)).toContain("env shape: varlock's .env.schema format");
  });

  it("shows no value and no control to set or read one, only the CLI line", () => {
    const markup = markupOf(page);
    const text = textOf(page);

    for (const control of ["<input", "<textarea", "<form", "<select"]) {
      expect(markup).not.toContain(control);
    }

    expect(markup).not.toMatch(/reveal|show value/iu);
    // The placeholder unlanded code sees is not a value, but reads like one.
    expect(markup).not.toContain("placeholder-sentry-auth-token");
    expect(text).toContain(
      `${Brand.cli} env set <KEY> --project datekit --yes`
    );
  });

  it("says a sensitive item nobody set is not set", () => {
    const unset = decodeView({
      ...Schema.encodeSync(EnvSchemaView)(datekit),
      items: items.map(({ value: _value, ...item }) => item),
    });

    const item = itemOf(
      markupOf(<EnvView now={now} schema={unset} />),
      "SENTRY_AUTH_TOKEN"
    );

    expect(item).toContain("not set");
    expect(item).not.toContain("set by");
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

    const markup = markupOf(<EnvView now={now} schema={view} />);

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

    expect(textOf(<EnvView now={now} schema={empty} />)).toContain(
      "No env items"
    );
  });
});

describe("a project with nothing landed", () => {
  it("says it has no env shape yet, rather than that it is unknown", () => {
    const text = textOf(<NothingLanded project={datekit.project} />);

    expect(text).toContain("Nothing has landed in datekit yet");
    expect(text).not.toContain("UnknownProject");
  });
});

describe("the env shape's way in", () => {
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
      /<a\b[^>]*href="\/datekit\/env"[^>]*>Env shape<\/a>/u
    );
  });
});
