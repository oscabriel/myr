import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { RpcTest } from "effect/rpc";

import { Contracts } from "../src/contracts.ts";
import { AskId, Handle, KindName, ProjectName } from "../src/ids.ts";
import { CurrentPrincipal, Principal } from "../src/principal.ts";
import { asPerson, asTester, unanswered } from "../src/testing.ts";

/** Contracts whose one listed ask wants whoever called: their handle, or `anyone`. */
const echoCaller = Layer.mergeAll(
  unanswered,
  Contracts.toLayerHandler("listAsks", () =>
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
    })
  )
);

/** Who the server side took the call to be, as `echoCaller` reports it. */
const caller = Effect.gen(function* () {
  const client = yield* RpcTest.makeClient(Contracts);

  const { asks } = yield* client.listAsks({
    project: ProjectName.make("oscabriel/datekit"),
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

describe("the unanswered handlers", () => {
  it.effect(
    "answer only the contracts a test sets up over them; any other call dies",
    () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Contracts);

        const listed = yield* client.listAsks({
          project: ProjectName.make("oscabriel/datekit"),
        });

        const other = yield* Effect.exit(
          client.credits({ handle: Handle.make("alice") })
        );

        expect(listed.asks.map(({ want }) => want)).toStrictEqual(["tester"]);
        expect(Exit.hasDies(other)).toBeTruthy();
      }).pipe(Effect.provide(Layer.mergeAll(echoCaller, asTester)))
  );
});
