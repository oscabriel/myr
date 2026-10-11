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
import { Client, Contracts, EnvSchemaOf } from "@repo/protocol/contracts";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import type { EnvItem } from "@repo/protocol/domain/env";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { UnknownProject } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { DateTime, Effect, Layer, Ref, Schema } from "effect";
import { RpcTest } from "effect/rpc";

import { EnvView, NothingLanded } from "../src/features/env/env-page.tsx";
import { ProjectView } from "../src/features/project/project-page.tsx";
import { readEnv } from "../src/routes/$owner/$project/env.tsx";
import { inOrder, markupOf, plainText, textOf } from "./ask-fixtures.ts";
import { textIn } from "./markup.ts";
import { elementWith, inspectorOf, mainOf } from "./records.ts";
import { renderAt } from "./render.tsx";

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

/** Each item's key, in the order the page lists them. */
const keysOf = (markup: string) =>
  [...mainOf(markup).matchAll(/data-env-key="(?<key>[^"]*)"/gu)].map(
    (found) => found.groups?.key
  );

describe("a project's env shape", () => {
  it("is titled Env shape, and its status line counts the items and says who set the sensitive one", () => {
    const markup = markupOf(page);

    expect(markup).toMatch(/<h1\b[^>]*>Env shape<\/h1>/u);
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
          <EnvView
            now={DateTime.makeUnsafe("2026-10-10T09:00:00Z")}
            schema={datekit}
          />
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

  it("credits the format to varlock, linked", () => {
    const markup = markupOf(page);

    expect(textOf(page)).toContain("env shape: varlock's .env.schema format");
    expect(markup).toMatch(/<a\b[^>]*href="https:\/\/varlock\.dev"/u);
  });

  it("says where it was read: the file, the landed commit and the environment", () => {
    const facts = inspectorOf(markupOf(page));

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
    expect(plainText(inspectorOf(markup))).toContain(
      `${Brand.cli} env set <KEY> --project oscabriel/datekit --yes`
    );
  });

  it("shows the project's posture in its facts once the project list has it", () => {
    const markup = markupOf(
      <EnvView now={now} posture="openWithSealedEvidence" schema={datekit} />
    );

    expect(inspectorOf(markup)).toContain(
      'data-posture="openWithSealedEvidence"'
    );
    expect(inspectorOf(markupOf(page))).not.toContain("data-posture=");
  });

  it("says a sensitive item nobody set is not set", () => {
    const unset = decodeView({
      ...Schema.encodeSync(EnvSchemaView)(datekit),
      items: items.map(({ value: _value, ...item }) => item),
    });

    const markup = markupOf(<EnvView now={now} schema={unset} />);
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

    const markup = mainOf(markupOf(<EnvView now={now} schema={view} />));

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

  it.effect("sits under the project's crumbs: datekit, then Env shape", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt("/oscabriel/datekit/env", page);
      const crumbs = elementWith(markup, 'aria-label="Breadcrumb"');

      expect(crumbs).toMatch(
        /<a\b[^>]*href="\/oscabriel\/datekit"[^>]*>oscabriel\/datekit<\/a>/u
      );
      expect(plainText(crumbs)).toContain("Env shape");
    })
  );
});

describe("a project with nothing landed", () => {
  it("says it has no env shape yet, rather than that it is unknown, with the command to read it", () => {
    const view = <NothingLanded project={datekit.project} />;
    const text = textOf(view);

    expect(markupOf(view)).toMatch(/<h1\b[^>]*>Env shape<\/h1>/u);
    expect(text).toContain("Nothing has landed in oscabriel/datekit yet");
    expect(text).toContain(
      `${Brand.cli} env shape --project oscabriel/datekit`
    );
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
      /<a\b[^>]*href="\/oscabriel\/datekit\/env"[^>]*>Env shape<\/a>/u
    );
  });
});

/** What the stub platform was asked: env shapes and ask lists. */
interface Asked {
  readonly asks: number;
  readonly schemas: number;
}

const nothingAsked: Asked = { asks: 0, schemas: 0 };

/**
 * A platform as the env page's loader calls it: `known` says whether it
 * knows datekit at all, `landed` whether datekit's main has landed (before
 * that, `envShape` has no commit to read and answers `UnknownProject`).
 */
const platformWhere = (
  asked: Ref.Ref<Asked>,
  { known, landed }: { readonly known: boolean; readonly landed: boolean }
) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler(EnvSchemaOf._tag, ({ project }) =>
          Effect.gen(function* () {
            yield* Ref.update(asked, (seen) => ({
              ...seen,
              schemas: seen.schemas + 1,
            }));

            if (!(known && landed) || project !== datekit.project) {
              return yield* new UnknownProject({ project });
            }

            return datekit;
          })
        ),
        Contracts.toLayerHandler("listAsks", ({ project }) =>
          Effect.gen(function* () {
            yield* Ref.update(asked, (seen) => ({
              ...seen,
              asks: seen.asks + 1,
            }));

            if (!known || project !== datekit.project) {
              return yield* new UnknownProject({ project });
            }

            return { asks: [] };
          })
        )
      ),
      asTester,
    ])
  );

describe(readEnv, () => {
  it.effect(
    "reads the env shape of a project whose main has landed, and asks nothing more",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const read = yield* readEnv("datekit").pipe(
          Effect.provide(platformWhere(asked, { known: true, landed: true }))
        );

        expect(read.project).toBe("oscabriel/datekit");
        expect(read.schema?.items.map(({ key }) => key)).toStrictEqual([
          "APP_ENV",
          "SENTRY_DSN",
          "SENTRY_AUTH_TOKEN",
          "DATEKIT_LOCALE_DIR",
        ]);
        expect(yield* Ref.get(asked)).toStrictEqual({ asks: 0, schemas: 1 });
      })
  );

  it.effect(
    "reads no env shape, and no 404, for a project whose main has not landed",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const read = yield* readEnv("datekit").pipe(
          Effect.provide(platformWhere(asked, { known: true, landed: false }))
        );

        expect(read.project).toBe("oscabriel/datekit");
        expect(read.schema).toBeUndefined();
        expect(yield* Ref.get(asked)).toStrictEqual({ asks: 1, schemas: 1 });
      })
  );

  it.effect("is a not-found for a project the platform does not know", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(nothingAsked);

      const failed = yield* Effect.flip(
        readEnv("oscabriel/no-such-project").pipe(
          Effect.provide(platformWhere(asked, { known: true, landed: true }))
        )
      );

      expect(isNotFound(failed)).toBeTruthy();
    })
  );

  it.effect(
    "is a not-found, asking nothing, for an address that names no project",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const failed = yield* Effect.flip(
          readEnv("Not_A-Project").pipe(
            Effect.provide(platformWhere(asked, { known: true, landed: true }))
          )
        );

        expect(isNotFound(failed)).toBeTruthy();
        expect(yield* Ref.get(asked)).toStrictEqual(nothingAsked);
      })
  );
});
