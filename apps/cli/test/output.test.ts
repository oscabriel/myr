import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Envelope } from "@repo/protocol/envelope";
import { CommitSha, RepoPath } from "@repo/protocol/ids";
import { StaleBase } from "@repo/protocol/refusal";
import { Effect, Schema } from "effect";
import { TestConsole } from "effect/testing";

import { Output, OutputPlain } from "../src/output.ts";

const refusal = new StaleBase({
  base: CommitSha.make("1111111111111111111111111111111111111111"),
  conflicts: [RepoPath.make("src/a.ts")],
  main: CommitSha.make("2222222222222222222222222222222222222222"),
});

const view = { markdown: "**2** open asks", text: "2 open asks" };

const printedBy = (use: (output: Output["Service"]) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    yield* Effect.flatMap(Effect.service(Output), use);

    return {
      err: (yield* TestConsole.errorLines).map(String),
      out: (yield* TestConsole.logLines).map(String),
    };
  }).pipe(Effect.provide([OutputPlain, TestConsole.layer]));

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

describe("plain output", () => {
  it.effect("prints a result as text for a person", () =>
    Effect.gen(function* () {
      const printed = yield* printedBy((output) =>
        output.success({
          command: "asks",
          data: { asks: [] },
          json: false,
          view,
        })
      );

      expect(printed).toStrictEqual({ err: [], out: ["2 open asks"] });
    })
  );

  it.effect("prints --json as exactly one envelope on stdout", () =>
    Effect.gen(function* () {
      const printed = yield* printedBy((output) =>
        Effect.andThen(
          output.note("asking the platform"),
          output.success({
            command: "asks",
            data: { asks: [] },
            json: true,
            view,
          })
        )
      );

      expect(printed.err).toStrictEqual(["asking the platform"]);
      expect(printed.out).toHaveLength(1);
      expect(yield* decodeEnvelope(printed.out[0] ?? "")).toStrictEqual({
        command: "asks",
        data: { asks: [] },
        ok: true,
        v: 1,
      });
    })
  );

  it.effect(
    "prints refusals in the envelope under --json, and nowhere else",
    () =>
      Effect.gen(function* () {
        const printed = yield* printedBy((output) =>
          output.refused({ command: "submit", json: true, refusals: [refusal] })
        );

        expect(printed.err).toStrictEqual([]);
        expect(printed.out).toHaveLength(1);
        expect(yield* decodeEnvelope(printed.out[0] ?? "")).toStrictEqual({
          command: "submit",
          ok: false,
          refusals: [refusal],
          v: 1,
        });
      })
  );

  it.effect(
    "prints refusals on stderr for a person, with what to run next",
    () =>
      Effect.gen(function* () {
        const printed = yield* printedBy((output) =>
          output.refused({
            command: "submit",
            json: false,
            refusals: [refusal],
          })
        );

        expect(printed.out).toStrictEqual([]);
        expect(printed.err.join("\n")).toContain(
          `git push ${Brand.slug} HEAD:main`
        );
      })
  );
});
