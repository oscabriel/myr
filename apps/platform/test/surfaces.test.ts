import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { AskId, CommitSha, Handle } from "@repo/protocol/ids";
import { CurrentPrincipal, Principal } from "@repo/protocol/principal";
import { NotClaimed } from "@repo/protocol/refusal";
import { Effect, Layer, Ref } from "effect";

import { MemorySessions } from "../src/sessions/memory.ts";
import { rpcClient, served, toolCall, toolResult } from "./harness.ts";

const ask = AskId.make("fix-parser");

const base = CommitSha.make("1111111111111111111111111111111111111111");

const main = CommitSha.make("2222222222222222222222222222222222222222");

const head = CommitSha.make("3333333333333333333333333333333333333333");

const sessions = MemorySessions.layer({
  "alice-token": Handle.make("alice"),
  "bob-token": Handle.make("bob"),
});

/** Contracts where only `holder` holds the ask's claim. */
const claimHeldBy = (holder: string) =>
  Contracts.toLayer({
    listAsks: () => Effect.succeed({ asks: [] }),
    submitAnswer: (payload) =>
      Effect.gen(function* () {
        const holds = Principal.match(yield* CurrentPrincipal, {
          Anonymous: () => false,
          Person: ({ handle }) => handle === holder,
        });

        if (!holds) {
          return yield* NotClaimed.of(payload.ask);
        }

        return { main };
      }),
  });

describe("the platform's MCP surface", () => {
  it.effect("calls a tool as the principal its bearer token names", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(
        Layer.mergeAll(claimHeldBy("alice"), sessions)
      );

      const args = { ask, base, head };

      const asAlice = yield* toolResult(
        yield* fetch(toolCall("submitAnswer", args, "alice-token"))
      );

      const asBob = yield* toolResult(
        yield* fetch(toolCall("submitAnswer", args, "bob-token"))
      );

      expect(asAlice).toStrictEqual({ isError: false, json: { main } });
      expect(asBob.isError).toBeTruthy();
      expect(asBob.json).toHaveProperty("_tag", "NotClaimed");
    })
  );

  it.effect(
    "turns away a call with no credential, or one it does not know",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const { fetch } = yield* served(
          Layer.mergeAll(
            Contracts.toLayer({
              listAsks: () =>
                Ref.update(calls, (count) => count + 1).pipe(
                  Effect.as({ asks: [] })
                ),
              submitAnswer: () =>
                Ref.update(calls, (count) => count + 1).pipe(
                  Effect.as({ main })
                ),
            }),
            sessions
          )
        );

        const args = { ask, base, head };

        const responses = [
          yield* fetch(toolCall("submitAnswer", args)),
          yield* fetch(toolCall("submitAnswer", args, "mallory-token")),
        ];

        expect(
          responses.map((response) => ({
            challenge: response.headers.get("www-authenticate"),
            status: response.status,
          }))
        ).toStrictEqual([
          { challenge: "Bearer", status: 401 },
          { challenge: "Bearer", status: 401 },
        ]);
        expect(yield* Ref.get(calls)).toBe(0);
      })
  );
});

describe("the platform's RPC surface", () => {
  it.effect("calls a contract as the principal its bearer token names", () =>
    Effect.gen(function* () {
      const { handler } = yield* served(
        Layer.mergeAll(claimHeldBy("alice"), sessions)
      );

      const args = { ask, base, head };

      const alice = yield* rpcClient(handler, "alice-token");
      const bob = yield* rpcClient(handler, "bob-token");

      expect(yield* alice.submitAnswer(args)).toStrictEqual({ main });
      expect(yield* Effect.flip(bob.submitAnswer(args))).toStrictEqual(
        NotClaimed.of(ask)
      );
    })
  );
});
