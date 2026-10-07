import { describe, expect, it } from "@effect/vitest";
import { Contracts, surfaced } from "@repo/protocol/contracts";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  Handle,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { CurrentPrincipal, Principal } from "@repo/protocol/principal";
import { NotClaimed } from "@repo/protocol/refusal";
import { Effect, Layer, Ref } from "effect";

import { MemorySessions } from "../src/sessions/memory.ts";
import {
  noProjects,
  origin,
  rpcClient,
  served,
  toolCall,
  toolList,
  toolNames,
  toolResult,
} from "./harness.ts";

const ask = AskId.make("fix-parser");

const base = CommitSha.make("1111111111111111111111111111111111111111");

const head = CommitSha.make("3333333333333333333333333333333333333333");

const project = ProjectName.make("datekit");

const requestId = RequestId.make("answer-0001");

/** An answer, as a client offers it. */
const args = { ask, base, head, project, requestId };

/** What the platform answers when it takes the answer in. */
const receipt = {
  ...args,
  outcome: Outcome.cases.Checking.make({ stage: "merge" }),
};

const sessions = MemorySessions.layer({
  "alice-token": Handle.make("alice"),
  "bob-token": Handle.make("bob"),
});

/** The platform where only `holder` holds the ask's claim. */
const claimHeldBy = (holder: string) =>
  Layer.mergeAll(
    noProjects,
    Contracts.toLayerHandler("submitAnswer", (payload) =>
      Effect.gen(function* () {
        const holds = Principal.match(yield* CurrentPrincipal, {
          Anonymous: () => false,
          Person: ({ handle }) => handle === holder,
        });

        if (!holds) {
          return yield* NotClaimed.of(payload.ask);
        }

        return receipt;
      })
    )
  );

describe("the platform's MCP surface", () => {
  it.effect("calls a tool as the principal its bearer token names", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(
        Layer.mergeAll(claimHeldBy("alice"), sessions)
      );

      const asAlice = yield* toolResult(
        yield* fetch(toolCall("submitAnswer", args, "alice-token"))
      );

      const asBob = yield* toolResult(
        yield* fetch(toolCall("submitAnswer", args, "bob-token"))
      );

      expect(asAlice).toStrictEqual({ isError: false, json: receipt });
      expect(asBob.isError).toBeTruthy();
      expect(asBob.json).toHaveProperty("_tag", "NotClaimed");
    })
  );

  // A stream has no tool form, and a write-only value must never pass
  // through an agent's transcript.
  it.effect("lists the MCP-surfaced contracts only: no watch, no setEnv", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(Layer.mergeAll(noProjects, sessions));

      const names = yield* toolNames(yield* fetch(toolList("alice-token")));

      expect(names).toStrictEqual([...surfaced("mcp").requests.keys()]);
      expect(names).toContain("submitAnswer");
      expect(names).not.toContain("watch");
      expect(names).not.toContain("setEnv");
    })
  );

  it.effect(
    "turns away a call with no credential, or one it does not know",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const counted = Effect.andThen(
          Ref.update(calls, (count) => count + 1),
          Effect.die("a turned-away call reached a contract")
        );

        const { fetch } = yield* served(
          Layer.mergeAll(
            noProjects,
            Contracts.toLayerHandler("listAsks", () => counted),
            Contracts.toLayerHandler("submitAnswer", () => counted),
            sessions
          )
        );

        const responses = [
          yield* fetch(toolCall("submitAnswer", args)),
          yield* fetch(toolCall("submitAnswer", args, "mallory-token")),
          yield* fetch(toolCall("listAsks", { project })),
          yield* fetch(toolCall("listAsks", { project }, "mallory-token")),
        ];

        const metadata = `resource_metadata="${origin}/.well-known/oauth-protected-resource"`;

        expect(
          responses.map((response) => ({
            challenge: response.headers.get("www-authenticate"),
            status: response.status,
          }))
        ).toStrictEqual([
          { challenge: `Bearer ${metadata}`, status: 401 },
          {
            challenge: `Bearer error="invalid_token", ${metadata}`,
            status: 401,
          },
          { challenge: `Bearer ${metadata}`, status: 401 },
          {
            challenge: `Bearer error="invalid_token", ${metadata}`,
            status: 401,
          },
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

      const alice = yield* rpcClient(handler, "alice-token");
      const bob = yield* rpcClient(handler, "bob-token");

      expect(yield* alice.submitAnswer(args)).toStrictEqual(receipt);
      expect(yield* Effect.flip(bob.submitAnswer(args))).toStrictEqual(
        NotClaimed.of(ask)
      );
    })
  );
});
