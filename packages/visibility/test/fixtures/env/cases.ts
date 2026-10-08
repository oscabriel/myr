/**
 * The env shape's fixtures (issue 603): each `.env.schema` beside it as
 * committed, the structure the parser reads it as (what the `/memory` fake
 * holds), and the env shape it gives. The same fixtures run through both
 * parsers (`env-shape.test.ts`), and the adapter's reading of each text is
 * held to its structure (`env-spec-adapter.test.ts`), so the fake says what
 * the real parser says.
 *
 * Where varlock's own tests show its behaviour, an expectation cites the
 * test it mirrors (VL §8.8: "defaults must match"), from the varlock clone at
 * `928e8e4b`, under `packages/varlock/src/env-graph/test/`.
 */
import type { EnvSchemaView } from "@repo/protocol/domain/env";
import { RepoPath } from "@repo/protocol/ids";

import type { ParsedEnvSchema } from "../../../src/env-schema.ts";
import absoluteImport from "./absolute-import.env.schema?raw";
import documented from "./documented.env.schema?raw";
import escapingImport from "./escaping-import.env.schema?raw";
import functionFlags from "./function-flags.env.schema?raw";
import header from "./header.env.schema?raw";
import homeImport from "./home-import.env.schema?raw";
import inferRequired from "./infer-required.env.schema?raw";
import prefix from "./prefix.env.schema?raw";
import proxy from "./proxy.env.schema?raw";
import silentHeader from "./silent-header.env.schema?raw";

/** The env shape a fixture gives, as the wire carries it, but for where and whose. */
export type ExpectedView = Omit<
  typeof EnvSchemaView.Encoded,
  "at" | "file" | "project"
>;

/** `forEnv(production)`, as the parser reads it. */
const forProduction = {
  fn: "forEnv",
  named: [],
  positional: ["production"],
  text: "forEnv(production)",
};

/** `$APP_ENV`, which the parser reads as the call `ref(APP_ENV)`. */
const appEnv = {
  fn: "ref",
  named: [],
  positional: ["APP_ENV"],
  text: "ref(APP_ENV)",
};

/** `@proxy(domain="…", path="…")`, as the parser reads it. */
const proxyTo = (domain: string, path: string) => ({
  name: "proxy",
  value: {
    named: [
      { key: "domain", value: domain },
      { key: "path", value: path },
    ],
    positional: [],
  },
});

/** One `.env.schema`: where it sits, its text, its parsed structure, and its env shape. */
export interface EnvFixture {
  readonly title: string;
  readonly file: RepoPath;
  readonly text: string;
  readonly parsed: ParsedEnvSchema;
  readonly view: ExpectedView;
}

export const fixtures: readonly EnvFixture[] = [
  {
    file: RepoPath.make("silent-header/.env.schema"),
    parsed: {
      header: [],
      imports: [],
      items: [
        {
          decorators: [],
          description: "The service's API key.",
          key: "API_KEY",
        },
        {
          decorators: [],
          description: "Where the service lives.",
          key: "SERVICE_URL",
          value: "https://api.example.invalid",
        },
        { decorators: [], key: "LOG_LEVEL", value: "info" },
      ],
    },
    text: silentHeader,
    title: "a silent header makes every item required and sensitive",
    view: {
      imports: [],
      // required-decorators.test.ts, "without any @defaultRequired, items are
      // required by default" (WITH_VALUE and NO_VALUE both required), and
      // sensitive-decorator.test.ts, "no @defaultSensitive set - sensitive by
      // default, can override" (DEFAULT sensitive).
      items: [
        {
          description: "The service's API key.",
          key: "API_KEY",
          required: true,
          sensitive: true,
          tags: [],
        },
        {
          description: "Where the service lives.",
          key: "SERVICE_URL",
          required: true,
          sensitive: true,
          tags: [],
        },
        { key: "LOG_LEVEL", required: true, sensitive: true, tags: [] },
      ],
    },
  },
  {
    file: RepoPath.make("infer-required/.env.schema"),
    parsed: {
      header: [
        { name: "defaultRequired", value: "infer" },
        { name: "defaultSensitive", value: false },
      ],
      imports: [],
      items: [
        {
          decorators: [],
          description: "Has a value, so it is required.",
          key: "PORT",
          value: "3000",
        },
        {
          decorators: [],
          description: "No value, so it is optional.",
          key: "CACHE_DIR",
        },
        { decorators: [], key: "EMPTY_STRING", value: "" },
        { decorators: [], key: "UNSET" },
        { decorators: [], key: "FN_VALUE", value: "eq(1, 1)" },
        {
          decorators: [{ name: "sensitive", value: true }],
          key: "SESSION_SECRET",
        },
        { decorators: [{ name: "required", value: true }], key: "ADMIN_EMAIL" },
        {
          decorators: [{ name: "optional", value: true }],
          key: "REGION",
          value: "eu",
        },
      ],
    },
    text: inferRequired,
    title:
      "@defaultRequired=infer requires an item with a value, and @defaultSensitive=false keeps unmarked items public",
    view: {
      imports: [],
      // required-decorators.test.ts, "@defaultRequired=infer will infer based
      // on if a value is present": STATIC_VALUE and FN_VALUE required;
      // EMPTY, UNDEFINED and EMPTY_STRING not; OVERRIDE_REQUIRED and
      // OVERRIDE_OPTIONAL win.
      // sensitive-decorator.test.ts, "static @defaultSensitive=false": TRUE
      // sensitive, DEFAULT not.
      items: [
        {
          description: "Has a value, so it is required.",
          key: "PORT",
          required: true,
          sensitive: false,
          tags: [],
        },
        {
          description: "No value, so it is optional.",
          key: "CACHE_DIR",
          required: false,
          sensitive: false,
          tags: [],
        },
        { key: "EMPTY_STRING", required: false, sensitive: false, tags: [] },
        { key: "UNSET", required: false, sensitive: false, tags: [] },
        { key: "FN_VALUE", required: true, sensitive: false, tags: [] },
        { key: "SESSION_SECRET", required: false, sensitive: true, tags: [] },
        { key: "ADMIN_EMAIL", required: true, sensitive: false, tags: [] },
        { key: "REGION", required: false, sensitive: false, tags: [] },
      ],
    },
  },
  {
    file: RepoPath.make("prefix/.env.schema"),
    parsed: {
      header: [
        {
          name: "defaultSensitive",
          value: {
            fn: "inferFromPrefix",
            named: [],
            positional: ["PUBLIC_"],
            text: "inferFromPrefix(PUBLIC_)",
          },
        },
      ],
      imports: [],
      items: [
        {
          decorators: [],
          key: "PUBLIC_URL",
          value: "https://datekit.example.invalid",
        },
        { decorators: [], key: "API_KEY" },
        {
          decorators: [{ name: "sensitive", value: true }],
          key: "PUBLIC_TOKEN",
        },
        { decorators: [{ name: "sensitive", value: false }], key: "BUILD_ID" },
      ],
    },
    text: prefix,
    title:
      "@defaultSensitive=inferFromPrefix(PUBLIC_) keeps PUBLIC_ items public and the rest sensitive",
    view: {
      imports: [],
      // sensitive-decorator.test.ts, "base case
      // @defaultSensitive=inferFromPrefix" (PUBLIC_FOO public, BAR
      // sensitive) and "explicit @sensitive overrides defaultSensitive".
      items: [
        { key: "PUBLIC_URL", required: true, sensitive: false, tags: [] },
        { key: "API_KEY", required: true, sensitive: true, tags: [] },
        { key: "PUBLIC_TOKEN", required: true, sensitive: true, tags: [] },
        { key: "BUILD_ID", required: true, sensitive: false, tags: [] },
      ],
    },
  },
  {
    file: RepoPath.make("function-flags/.env.schema"),
    parsed: {
      header: [
        { name: "currentEnv", value: appEnv },
        { name: "defaultRequired", value: false },
        { name: "defaultSensitive", value: false },
      ],
      imports: [],
      items: [
        { decorators: [], key: "APP_ENV", value: "development" },
        {
          decorators: [
            { name: "sensitive", value: true },
            { name: "required", value: forProduction },
          ],
          key: "SENTRY_AUTH_TOKEN",
        },
        {
          decorators: [{ name: "sensitive", value: forProduction }],
          key: "PARTNER_TOKEN",
        },
        {
          decorators: [
            {
              name: "public",
              value: {
                fn: "forEnv",
                named: [],
                positional: ["development"],
                text: "forEnv(development)",
              },
            },
          ],
          key: "PREVIEW_URL",
        },
        {
          decorators: [
            {
              name: "sensitive",
              value: {
                named: [
                  { key: "enabled", value: forProduction },
                  { key: "preventLeaks", value: false },
                ],
                positional: [],
              },
            },
          ],
          key: "FORWARDED_TOKEN",
        },
        {
          decorators: [
            {
              name: "sensitive",
              value: {
                named: [{ key: "preventLeaks", value: false }],
                positional: [],
              },
            },
          ],
          key: "WEBHOOK_SECRET",
        },
        {
          decorators: [
            {
              name: "sensitive",
              value: {
                named: [{ key: "enabled", value: false }],
                positional: [],
              },
            },
          ],
          key: "TRACE_ID",
        },
        {
          decorators: [
            {
              name: "optional",
              value: {
                fn: "eq",
                named: [],
                positional: [appEnv, "development"],
                text: "eq(ref(APP_ENV), development)",
              },
            },
          ],
          key: "DEBUG_TOKEN",
        },
      ],
    },
    text: functionFlags,
    title:
      "a flag only the environment decides counts as sensitive, and as depends for required",
    view: {
      currentEnvKey: "APP_ENV",
      imports: [],
      // ADR 0009 and VL §8.3 #3: a function-valued flag fails safe. Where the
      // flag is static, varlock decides: sensitive-decorator.test.ts,
      // "enabled=false toggles the item to not sensitive" (OFF public, ON
      // sensitive) and "opts an item out of leak detection while keeping it
      // sensitive".
      items: [
        { key: "APP_ENV", required: false, sensitive: false, tags: [] },
        {
          key: "SENTRY_AUTH_TOKEN",
          required: "depends",
          sensitive: true,
          tags: [],
        },
        { key: "PARTNER_TOKEN", required: false, sensitive: true, tags: [] },
        { key: "PREVIEW_URL", required: false, sensitive: true, tags: [] },
        { key: "FORWARDED_TOKEN", required: false, sensitive: true, tags: [] },
        { key: "WEBHOOK_SECRET", required: false, sensitive: true, tags: [] },
        { key: "TRACE_ID", required: false, sensitive: false, tags: [] },
        { key: "DEBUG_TOKEN", required: "depends", sensitive: false, tags: [] },
      ],
    },
  },
  {
    file: RepoPath.make("proxy/.env.schema"),
    parsed: {
      header: [
        { name: "defaultRequired", value: false },
        { name: "defaultSensitive", value: false },
      ],
      imports: [],
      items: [
        {
          decorators: [proxyTo("sentry.io", "/api/**")],
          key: "SENTRY_AUTH_TOKEN",
        },
        {
          decorators: [
            {
              name: "proxy",
              value: {
                named: [
                  {
                    key: "domain",
                    value: ["api.stripe.com", "files.stripe.com"],
                  },
                  { key: "method", value: ["GET", "POST"] },
                ],
                positional: [],
              },
            },
          ],
          key: "STRIPE_KEY",
        },
        {
          decorators: [
            {
              name: "proxy",
              value: {
                named: [
                  { key: "domain", value: "internal.example.invalid" },
                  { key: "block", value: true },
                ],
                positional: [],
              },
            },
          ],
          key: "BLOCKED_TOKEN",
        },
        {
          decorators: [
            { name: "public", value: true },
            {
              name: "proxy",
              value: {
                named: [{ key: "domain", value: "api.openai.com" }],
                positional: [],
              },
            },
            { name: "placeholder", value: "sk-proj-000000000000000000000000" },
          ],
          description: "Public as written, sensitive by its proxy.",
          key: "OPENAI_API_KEY",
        },
        {
          decorators: [
            {
              name: "proxy",
              value: {
                named: [
                  { key: "domain", value: "hooks.example.invalid" },
                  { key: "approval", value: true },
                ],
                positional: [],
              },
            },
          ],
          key: "HOOK_TOKEN",
        },
        {
          decorators: [
            proxyTo("a.example.invalid", "/v1/**"),
            proxyTo("b.example.invalid", "/v1/**"),
            proxyTo("c.example.invalid", "/admin/**"),
          ],
          key: "SPLIT_TOKEN",
        },
        {
          decorators: [
            { name: "sensitive", value: true },
            { name: "proxy", value: "passthrough" },
          ],
          key: "LEGACY_TOKEN",
        },
        {
          decorators: [
            {
              name: "proxy",
              value: {
                named: [
                  { key: "domain", value: "api.example.invalid" },
                  { key: "substituteIn", value: ["header:authorization"] },
                ],
                positional: [],
              },
            },
          ],
          key: "NARROW_TOKEN",
        },
        {
          decorators: [
            {
              name: "proxy",
              value: {
                named: [
                  { key: "domain", value: "oauth.example.invalid" },
                  { key: "path", value: "/oauth/token" },
                  {
                    key: "substituteIn",
                    value: ["header", "body:client_secret"],
                  },
                ],
                positional: [],
              },
            },
          ],
          key: "CLIENT_SECRET",
        },
        {
          decorators: [
            {
              name: "proxy",
              value: {
                named: [
                  { key: "domain", value: "registry.example.invalid" },
                  {
                    key: "transform",
                    value: {
                      named: [{ key: "scheme", value: "http-basic" }],
                      positional: [],
                    },
                  },
                ],
                positional: [],
              },
            },
          ],
          key: "REGISTRY_TOKEN",
        },
      ],
    },
    text: proxy,
    title:
      "@proxy keeps its hosts in order, its path, method and block, and makes its item sensitive",
    view: {
      imports: [],
      // proxy-mode.test.ts, "item @proxy implies sensitive" (under
      // @defaultSensitive=false) and "domain and method accept array literals
      // (lists)" (both lists in order). A rule the platform can't honour
      // exactly, one that waits on an approval or a rule for another path,
      // is blocked rather than widened.
      items: [
        {
          key: "SENTRY_AUTH_TOKEN",
          proxy: { domains: ["sentry.io"], path: "/api/**" },
          required: false,
          sensitive: true,
          tags: [],
        },
        {
          key: "STRIPE_KEY",
          proxy: {
            domains: ["api.stripe.com", "files.stripe.com"],
            method: "GET, POST",
          },
          required: false,
          sensitive: true,
          tags: [],
        },
        {
          key: "BLOCKED_TOKEN",
          proxy: { block: true, domains: ["internal.example.invalid"] },
          required: false,
          sensitive: true,
          tags: [],
        },
        {
          description: "Public as written, sensitive by its proxy.",
          key: "OPENAI_API_KEY",
          placeholder: "sk-proj-000000000000000000000000",
          proxy: { domains: ["api.openai.com"] },
          required: false,
          sensitive: true,
          tags: [],
        },
        {
          key: "HOOK_TOKEN",
          proxy: { block: true, domains: ["hooks.example.invalid"] },
          required: false,
          sensitive: true,
          tags: [],
        },
        {
          key: "SPLIT_TOKEN",
          proxy: {
            domains: ["a.example.invalid", "b.example.invalid"],
            path: "/v1/**",
          },
          required: false,
          sensitive: true,
          tags: [],
        },
        { key: "LEGACY_TOKEN", required: false, sensitive: true, tags: [] },
        // guides/proxy/rules.mdx, "Substitution surface": varlock swaps
        // into any header by default; the platform does the same, so a
        // rule that allows only `header:authorization` would be widened,
        // and one that names `header` among its targets is not.
        {
          key: "NARROW_TOKEN",
          proxy: { block: true, domains: ["api.example.invalid"] },
          required: false,
          sensitive: true,
          tags: [],
        },
        {
          key: "CLIENT_SECRET",
          proxy: { domains: ["oauth.example.invalid"], path: "/oauth/token" },
          required: false,
          sensitive: true,
          tags: [],
        },
        // guides/proxy/rules.mdx, "Request transforms": the credential is
        // computed at the wire, which the platform does not do.
        {
          key: "REGISTRY_TOKEN",
          proxy: { block: true, domains: ["registry.example.invalid"] },
          required: false,
          sensitive: true,
          tags: [],
        },
      ],
    },
  },
  {
    file: RepoPath.make("documented/.env.schema"),
    parsed: {
      header: [
        { name: "defaultRequired", value: false },
        { name: "defaultSensitive", value: false },
      ],
      imports: [],
      items: [
        {
          decorators: [
            {
              name: "type",
              value: {
                fn: "enum",
                named: [],
                positional: ["development", "test", "production"],
                text: "enum(development, test, production)",
              },
            },
          ],
          description: "The deployment's environment.",
          key: "APP_ENV",
          value: "development",
        },
        {
          decorators: [
            {
              name: "type",
              value: {
                fn: "string",
                named: [{ key: "startsWith", value: "sk-" }],
                positional: [],
                text: "string(startsWith=sk-)",
              },
            },
            { name: "tag", value: { named: [], positional: ["billing"] } },
            {
              name: "tag",
              value: { named: [], positional: ["prod", "billing"] },
            },
            {
              name: "docs",
              value: {
                named: [],
                positional: ["https://docs.example.invalid/keys"],
              },
            },
            { name: "sensitive", value: true },
          ],
          key: "STRIPE_KEY",
        },
        {
          decorators: [
            { name: "type", value: "url" },
            { name: "deprecated", value: "Use API_URL instead" },
            {
              name: "docs",
              value: {
                named: [],
                positional: ["API guide", "https://docs.example.invalid/api"],
              },
            },
          ],
          description: "Old name of the API URL.",
          key: "LEGACY_API_URL",
        },
        { decorators: [{ name: "deprecated", value: false }], key: "REGION" },
        {
          decorators: [{ name: "type", value: "opServiceAccountToken" }],
          description: "A credential type only a plugin knows.",
          key: "OP_TOKEN",
        },
      ],
    },
    text: documented,
    title:
      "the shape shows each item's description, @type text, tags, docs link and deprecation",
    view: {
      imports: [],
      // deprecated-decorator.test.ts, "@deprecated with a string message
      // exposes the deprecation message" (deprecated) and "@deprecated=false
      // does not mark the item as deprecated". A type only a plugin knows
      // may be a sensitive credential type, which overrides
      // @defaultSensitive in varlock (sensitive-decorator.test.ts, "data
      // type sensitive skips @defaultSensitive"); no plugin is loaded here,
      // so it counts as sensitive.
      items: [
        {
          description: "The deployment's environment.",
          key: "APP_ENV",
          required: false,
          sensitive: false,
          tags: [],
          type: "enum(development, test, production)",
        },
        {
          docs: "https://docs.example.invalid/keys",
          key: "STRIPE_KEY",
          required: false,
          sensitive: true,
          tags: ["billing", "prod"],
          type: "string(startsWith=sk-)",
        },
        {
          deprecated: true,
          description: "Old name of the API URL.",
          docs: "https://docs.example.invalid/api",
          key: "LEGACY_API_URL",
          required: false,
          sensitive: false,
          tags: [],
          type: "url",
        },
        {
          deprecated: false,
          key: "REGION",
          required: false,
          sensitive: false,
          tags: [],
        },
        {
          description: "A credential type only a plugin knows.",
          key: "OP_TOKEN",
          required: false,
          sensitive: true,
          tags: [],
          type: "opServiceAccountToken",
        },
      ],
    },
  },
  {
    file: RepoPath.make("apps/api/.env.schema"),
    parsed: {
      header: [
        { name: "currentEnv", value: appEnv },
        {
          name: "import",
          value: { named: [], positional: ["../shared/.env.schema"] },
        },
        {
          name: "import",
          value: {
            named: [{ key: "pick", value: ["EXTRA_KEY"] }],
            positional: ["./.env.extra"],
          },
        },
        {
          name: "plugin",
          value: { named: [], positional: ["@varlock/1password-plugin"] },
        },
      ],
      imports: ["apps/shared/.env.schema", "apps/api/.env.extra"],
      items: [{ decorators: [], key: "APP_ENV", value: "development" }],
    },
    text: header,
    title:
      "the header names the @currentEnv item and records imports inside the repo; @plugin is ignored",
    view: {
      currentEnvKey: "APP_ENV",
      imports: ["apps/shared/.env.schema", "apps/api/.env.extra"],
      items: [{ key: "APP_ENV", required: true, sensitive: true, tags: [] }],
    },
  },
];

/** A `.env.schema` the platform refuses to read, and why. */
export interface RefusedFixture {
  readonly title: string;
  readonly file: RepoPath;
  readonly text: string;
  readonly parsed: ParsedEnvSchema;
  readonly reason: string;
}

/** `API_KEY=` under a header that imports `path`, as the parser reads it. */
const importing = (path: string): ParsedEnvSchema => ({
  header: [{ name: "import", value: { named: [], positional: [path] } }],
  imports: [],
  items: [{ decorators: [], key: "API_KEY" }],
});

export const refused: readonly RefusedFixture[] = [
  {
    file: RepoPath.make("home-import/.env.schema"),
    parsed: importing("~/.env.shared"),
    reason: "imports ~/.env.shared, outside the repo",
    text: homeImport,
    title: "an import from the home folder",
  },
  {
    file: RepoPath.make("absolute-import/.env.schema"),
    parsed: importing("/etc/datekit/.env.schema"),
    reason: "imports /etc/datekit/.env.schema, outside the repo",
    text: absoluteImport,
    title: "an import by absolute path",
  },
  {
    file: RepoPath.make("escaping-import/.env.schema"),
    parsed: importing("../../.env.schema"),
    reason: "imports ../../.env.schema, above the repo's root",
    text: escapingImport,
    title: "an import from above the repo's root",
  },
];

/** What the `/memory` fake holds: every fixture's parsed structure, by its file. */
export const parsedByFile: ReadonlyMap<RepoPath, ParsedEnvSchema> = new Map(
  [...fixtures, ...refused].map(({ file, parsed }) => [file, parsed])
);
