import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/rpc";

import { Contracts } from "../src/contracts.ts";
import { AskId, Handle, KindName, ProjectName } from "../src/ids.ts";
import { CurrentPrincipal, Principal } from "../src/principal.ts";
import { NotClaimed } from "../src/refusal.ts";
import { asPerson, asTester } from "../src/testing.ts";

/** Contracts whose one listed ask wants whoever called: their handle, or `anyone`. */
const echoCaller = Contracts.toLayer({
  listAsks: () =>
    Effect.gen(function* () {
      const caller = Principal.match(yield* CurrentPrincipal, {
        Anonymous: () => "anyone",
        Person: ({ handle }) => handle,
      });

      return {
        asks: [
          {
            ask: AskId.make("whoami"),
            blockedBy: [],
            claimed: false,
            kind: KindName.make("fix"),
            territory: ".",
            want: caller,
          },
        ],
      };
    }),
  submitAnswer: ({ ask }) => Effect.fail(NotClaimed.of(ask)),
});

/** Who the server side took the call to be, as `echoCaller` reports it. */
const caller = Effect.gen(function* () {
  const client = yield* RpcTest.makeClient(Contracts);

  const { asks } = yield* client.listAsks({
    project: ProjectName.make("datekit"),
  });

  return asks.map(({ want }) => want);
});

describe("the test principals", () => {
  it.effect("asPerson runs every call as the person it names", () =>
    Effect.gen(function* () {
      expect(yield* caller).toStrictEqual(["alice"]);
    }).pipe(
      Effect.provide(Layer.mergeAll(echoCaller, asPerson(Handle.make("alice"))))
    )
  );

  it.effect("asTester runs every call as one person, the tester", () =>
    Effect.gen(function* () {
      expect(yield* caller).toStrictEqual(["tester"]);
    }).pipe(Effect.provide(Layer.mergeAll(echoCaller, asTester)))
  );
});
