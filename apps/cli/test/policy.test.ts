import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import { Envelope } from "@repo/protocol/envelope";
import { AskId, KindName } from "@repo/protocol/ids";
import { AskFull } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { unanswered } from "@repo/protocol/testing";
import { Effect, Layer, Option, Schema } from "effect";

import { detectMode } from "../src/policy.ts";
import { runProgram } from "./remote-server.ts";

const fixWeek = AskId.make("fix-week");

const listing = {
  ask: fixWeek,
  blockedBy: [],
  claimed: false,
  kind: KindName.make("fix"),
  territory: "packages/week",
  want: "Weeks start on the locale's first day",
};

/** `listAsks` lists one open ask; `claim` finds it taken. */
const platform = Layer.mergeAll(
  unanswered,
  Contracts.toLayerHandler("listAsks", () =>
    Effect.succeed({ asks: [listing] })
  ),
  Contracts.toLayerHandler("claim", ({ ask }) =>
    Effect.fail(new AskFull({ ask }))
  )
);

const agent = { CLAUDECODE: "1" };

const decodeEnvelope = Schema.decodeEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

describe("who the CLI is talking to", () => {
  it("is an agent when a harness's marker is set, even at a terminal", () => {
    const detected = detectMode({ env: agent, isTTY: true });

    expect([detected.mode, detected.harness]).toStrictEqual([
      "agent",
      Option.some("claude-code"),
    ]);
  });

  it.each([
    { env: {}, isTTY: false, mode: "automation" },
    { env: { CI: "true" }, isTTY: true, mode: "automation" },
    { env: {}, isTTY: true, mode: "human" },
    { env: { AI_AGENT: "pi" }, isTTY: false, mode: "agent" },
  ] as const)(
    "is $mode with env $env and a terminal: $isTTY",
    ({ env, isTTY, mode }) => {
      const detected = detectMode({ env, isTTY });

      expect(detected.mode).toBe(mode);
      expect(detected.reason).not.toBe("");
    }
  );
});

describe("under an agent", () => {
  it.effect("prints asks as a Markdown table and never prompts", () =>
    Effect.gen(function* () {
      const run = yield* runProgram(["asks", "--project", "datekit"], {
        env: agent,
        handlers: platform,
      });

      expect(run.out).toContain("| ask | kind | territory | want | claimed |");
      expect(run.out.join("\n")).toContain("fix-week");
      expect(run.prompts).toBe(0);
      expect(run.code).toBe(0);
    })
  );

  it.effect(
    "prints exactly one versioned envelope under --json, and nothing on stderr",
    () =>
      Effect.gen(function* () {
        const run = yield* runProgram(
          ["asks", "--project", "datekit", "--json"],
          { env: agent, handlers: platform }
        );

        expect(run.out).toHaveLength(1);
        expect(run.err).toStrictEqual([]);
        expect(yield* decodeEnvelope(run.out[0] ?? "")).toStrictEqual({
          command: "asks",
          data: { asks: [listing] },
          ok: true,
          v: 1,
        });
      })
  );

  it.effect(
    "prints a refusal as one refused envelope under --json, and exits 1",
    () =>
      Effect.gen(function* () {
        const run = yield* runProgram(
          ["claim", "fix-week", "--project", "datekit", "--json"],
          { env: agent, handlers: platform }
        );

        expect(run.out).toHaveLength(1);
        expect(run.err).toStrictEqual([]);
        expect(run.code).toBe(1);
        expect(yield* decodeEnvelope(run.out[0] ?? "")).toStrictEqual({
          command: "claim",
          ok: false,
          refusals: [new AskFull({ ask: fixWeek })],
          v: 1,
        });
      })
  );

  it.effect(
    "prints a refusal's explanation once on stderr without --json, and nothing on stdout",
    () =>
      Effect.gen(function* () {
        const run = yield* runProgram(
          ["claim", "fix-week", "--project", "datekit"],
          { env: agent, handlers: platform }
        );

        const [reason = ""] = explain([new AskFull({ ask: fixWeek })]);
        const printed = run.err.join("\n");

        expect(run.out).toStrictEqual([]);
        expect(run.code).toBe(1);
        expect(printed.split(reason)).toHaveLength(2);
        expect(run.err).toStrictEqual([
          `- ${reason}`,
          `  - Next: \`${Brand.cli} asks\``,
          "  - Retryable: yes",
        ]);
      })
  );
});

describe("for a person at a terminal", () => {
  it.effect("prints asks as text, not Markdown", () =>
    Effect.gen(function* () {
      const run = yield* runProgram(["asks", "--project", "datekit"], {
        handlers: platform,
      });

      expect(run.out.join("\n")).toContain("fix-week");
      expect(run.out.join("\n")).not.toContain("| ask |");
      expect(run.prompts).toBe(0);
    })
  );
});
