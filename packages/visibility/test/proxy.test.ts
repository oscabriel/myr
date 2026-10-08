import { describe, expect, it } from "@effect/vitest";
import { EnvItem } from "@repo/protocol/domain/env";
import { EnvKey } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { placeholderFor, proxyMap } from "../src/proxy.ts";

const item = Schema.decodeUnknownSync(EnvItem);

/** datekit's one `@sensitive` item, behind `@proxy(domain="sentry.io", path="/api/**")`. */
const sentryAuthToken = item({
  description:
    "Source-map upload token. Release step only; never enters a check.",
  key: "SENTRY_AUTH_TOKEN",
  proxy: { domains: ["sentry.io"], path: "/api/**" },
  required: "depends",
  sensitive: true,
  tags: ["release"],
});

/**
 * datekit's `.env.schema` (507) as its env shape reads: `@defaultSensitive=false`
 * in the header, and one `@sensitive` item behind
 * `@proxy(domain="sentry.io", path="/api/**")`.
 */
const datekit = {
  items: [
    item({
      key: "APP_ENV",
      required: true,
      sensitive: false,
      tags: [],
      type: "enum(development, test, production)",
    }),
    item({
      description: "Error reporting DSN. Public: it ships in builds.",
      key: "SENTRY_DSN",
      required: true,
      sensitive: false,
      tags: [],
      type: "url",
    }),
    sentryAuthToken,
    item({
      description: "Where locale data lives.",
      key: "DATEKIT_LOCALE_DIR",
      required: true,
      sensitive: false,
      tags: [],
    }),
  ],
};

const sensitive = (key: string, rest: Partial<typeof EnvItem.Encoded>) =>
  item({ key, required: true, sensitive: true, tags: [], ...rest });

describe("the outbound map", () => {
  it("gives datekit one rule: sentry.io's API, any method, the token behind a placeholder", () => {
    expect(proxyMap(datekit)).toStrictEqual([
      {
        block: false,
        host: "sentry.io",
        key: EnvKey.make("SENTRY_AUTH_TOKEN"),
        method: Option.none(),
        path: Option.some("/api/**"),
        placeholder: "__SENTRY_AUTH_TOKEN_PLACEHOLDER__",
      },
    ]);
  });

  it("gives a blocked item a rule that denies", () => {
    expect(
      proxyMap({
        items: [
          sensitive("ANALYTICS_KEY", {
            proxy: { block: true, domains: ["telemetry.example.com"] },
          }),
        ],
      })
    ).toStrictEqual([
      {
        block: true,
        host: "telemetry.example.com",
        key: EnvKey.make("ANALYTICS_KEY"),
        method: Option.none(),
        path: Option.none(),
        placeholder: "__ANALYTICS_KEY_PLACEHOLDER__",
      },
    ]);
  });

  it("keeps a glob domain as written, and gives each domain its own rule", () => {
    expect(
      proxyMap({
        items: [
          sensitive("API_TOKEN", {
            proxy: {
              domains: ["*.example.com", "api.example.org"],
              method: "POST",
            },
          }),
        ],
      }).map(({ host, method }) => ({ host, method }))
    ).toStrictEqual([
      { host: "*.example.com", method: Option.some("POST") },
      { host: "api.example.org", method: Option.some("POST") },
    ]);
  });

  it("ignores @proxy on an item that is not @sensitive: only those hold values", () => {
    expect(
      proxyMap({
        items: [
          item({
            key: "PUBLIC_URL",
            proxy: { domains: ["cdn.example.com"] },
            required: true,
            sensitive: false,
            tags: [],
          }),
        ],
      })
    ).toStrictEqual([]);
  });
});

describe("a placeholder", () => {
  it("is the item's own @placeholder when it has one", () => {
    expect(
      placeholderFor(
        sensitive("STRIPE_KEY", { placeholder: "sk_test_placeholder" })
      )
    ).toBe("sk_test_placeholder");
  });

  it("is otherwise made from the key alone, the same every time", () => {
    expect(placeholderFor(sentryAuthToken)).toBe(
      "__SENTRY_AUTH_TOKEN_PLACEHOLDER__"
    );
    expect(placeholderFor(sensitive("DB_PASSWORD", {}))).toBe(
      "__DB_PASSWORD_PLACEHOLDER__"
    );
  });
});
