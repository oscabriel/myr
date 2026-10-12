import { describe, expect, it } from "@effect/vitest";
import { Envelope } from "@repo/protocol/envelope";
import { unanswered } from "@repo/protocol/testing";
import { Effect, Schema } from "effect";

import { runProgram } from "./remote-server.ts";

const PayloadSchema = Schema.fromJsonString(
  Schema.Struct({
    $schema: Schema.String,
    properties: Schema.Record(
      Schema.String,
      Schema.Struct({
        description: Schema.optionalKey(Schema.String),
        type: Schema.optionalKey(Schema.String),
        writeOnly: Schema.optionalKey(Schema.Boolean),
      })
    ),
    required: Schema.Array(Schema.String),
    type: Schema.Literal("object"),
  })
);

const decodePayloadSchema = Schema.decodeEffect(PayloadSchema);

const schemaOf = (words: readonly string[], env = {}) =>
  runProgram(["schema", ...words], { env, handlers: unanswered });

describe("schema <command>", () => {
  it.effect("prints claim's payload: project and ask, both required", () =>
    Effect.gen(function* () {
      const run = yield* schemaOf(["claim"]);
      const printed = yield* decodePayloadSchema(run.out.join("\n"));

      expect(run.code).toBe(0);
      expect(Object.keys(printed.properties)).toStrictEqual(
        expect.arrayContaining(["project", "ask"])
      );
      expect(printed.required).toStrictEqual(
        expect.arrayContaining(["project", "ask"])
      );
    })
  );

  it.effect("prints it as one document even for an agent", () =>
    Effect.gen(function* () {
      const run = yield* schemaOf(["ask", "open"], { CLAUDECODE: "1" });
      const printed = yield* decodePayloadSchema(run.out.join("\n"));

      expect(printed.required).toStrictEqual(
        expect.arrayContaining(["project", "ask", "files"])
      );
    })
  );

  it.effect("describes env set's value as write-only", () =>
    Effect.gen(function* () {
      const run = yield* schemaOf(["env", "set"]);
      const printed = yield* decodePayloadSchema(run.out.join("\n"));

      const { key, value } = printed.properties;

      expect([value?.type, value?.writeOnly]).toStrictEqual(["string", true]);
      expect(value?.description).toContain("Write-only");
      expect(key?.writeOnly).toBeUndefined();
    })
  );

  it.effect("prints one envelope under --json", () =>
    Effect.gen(function* () {
      const run = yield* schemaOf(["claim", "--json"]);

      const envelope = yield* Schema.decodeEffect(
        Schema.fromJsonString(Envelope(Schema.Unknown))
      )(run.out.join("\n"));

      expect(envelope).toStrictEqual(
        expect.objectContaining({ command: "schema", ok: true, v: 1 })
      );
    })
  );

  it.effect.each([["no-such-command"], ["check"], ["ask", "close"]])(
    "exits 2 for a command with no payload: %j",
    (words) =>
      Effect.gen(function* () {
        const run = yield* schemaOf(words);

        expect(run.code).toBe(2);
        expect(run.out).toStrictEqual([]);
        expect(run.err).toHaveLength(1);
      })
  );
});
