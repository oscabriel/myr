import { describe, expect, it } from "@effect/vitest";
import { EnvSchemaView } from "@repo/protocol/domain/env";
import { LandedSha, ProjectName } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { EnvSchemaParser } from "../src/env-schema.ts";
import { EnvSchemaParserEnvSpec } from "../src/env-schema/env-spec.ts";
import { EnvSchemaParserMemory } from "../src/env-schema/memory.ts";
import {
  envSchemaViewOf,
  isSensitive,
  proxyOf,
  requiredOf,
} from "../src/env-shape.ts";
import { fixtures, parsedByFile, refused } from "./fixtures/env/cases.ts";

const project = ProjectName.make("oscabriel/datekit");

const at = LandedSha.make("a1".repeat(20));

// The env shape (ADR 0009): a project's `.env.schema`,
// parsed at a landed SHA through the parser seam and never resolved, as the
// public sees it.
const parsers = [
  ["the /memory fake", EnvSchemaParserMemory(parsedByFile)],
  ["the /env-spec adapter", EnvSchemaParserEnvSpec],
] as const;

describe.each(parsers)("the env shape, read through %s", (_, layer) => {
  it.effect.each(fixtures)("$title", ({ file, text, view }) =>
    Effect.gen(function* () {
      const parser = yield* EnvSchemaParser;
      const parsed = yield* parser.parse(file, text);
      const shown = envSchemaViewOf({ at, file, parsed, project });

      expect(yield* Schema.encodeEffect(EnvSchemaView)(shown)).toStrictEqual({
        ...view,
        at,
        file,
        project,
      });
    }).pipe(Effect.provide(layer))
  );

  // An import from outside the repo is never followed, so the
  // schema that names one is refused whole.
  it.effect.each(refused)("refuses $title", ({ file, reason, text }) =>
    Effect.gen(function* () {
      const parser = yield* EnvSchemaParser;
      const unreadable = yield* Effect.flip(parser.parse(file, text));

      expect(unreadable._tag).toBe("EnvSchemaUnreadable");
      expect(unreadable.file).toBe(file);
      expect(unreadable.reason).toBe(reason);
    }).pipe(Effect.provide(layer))
  );
});

// The pure readers where varlock would refuse the schema or only the
// environment decides: they fail safe, never toward showing or sending a
// value.
describe("the env shape's readers", () => {
  const host = {
    fn: "ref",
    named: [],
    positional: ["UPLOAD_HOST"],
    text: "ref(UPLOAD_HOST)",
  };

  const proxiedTo = {
    decorators: [
      {
        name: "proxy",
        value: { named: [{ key: "domain", value: host }], positional: [] },
      },
    ],
    key: "UPLOAD_TOKEN",
  };

  it("send a value to no host the environment names, and keep its item sensitive", () => {
    expect(proxyOf(proxiedTo)).toStrictEqual(Option.none());
    expect(
      isSensitive(proxiedTo, [{ name: "defaultSensitive", value: false }])
    ).toBeTruthy();
  });

  it("read @proxy=passthrough as no rule", () => {
    const passthrough = {
      decorators: [{ name: "proxy", value: "passthrough" }],
      key: "LEGACY_TOKEN",
    };

    expect(proxyOf(passthrough)).toStrictEqual(Option.none());
    expect(
      isSensitive(passthrough, [{ name: "defaultSensitive", value: false }])
    ).toBeFalsy();
  });

  it("count a header default only the environment decides as sensitive, and as depends", () => {
    const item = { decorators: [], key: "API_KEY", value: "x" };

    const header = [
      {
        name: "defaultRequired",
        value: { ...host, fn: "forEnv", text: "forEnv(prod)" },
      },
      { name: "defaultSensitive", value: "maybe" },
    ];

    expect(requiredOf(item, header)).toBe("depends");
    expect(isSensitive(item, header)).toBeTruthy();
  });
});
