import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref } from "effect";
import { RpcTest } from "effect/rpc";

import { authenticated, bearerToken } from "../src/authenticate.ts";
import { Contracts } from "../src/contracts.ts";
import { Handle, ProjectName } from "../src/ids.ts";
import {
  Anonymous,
  CurrentPrincipal,
  Person,
  Unauthenticated,
} from "../src/principal.ts";
import type { Principal } from "../src/principal.ts";
import { unanswered } from "../src/testing.ts";

const project = ProjectName.make("datekit");

const alice = Person.make({ handle: Handle.make("alice") });

/** The credentials the platform knows: one token, alice's. */
const verify = (credential: string) =>
  Effect.succeed(
    credential === "alice-token" ? Option.some(alice) : Option.none()
  );

const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});

/**
 * A client of the contracts whose server side is `authenticated(verify)`.
 * `listAsks` (public) and `status` (signed in) note who called them; `callers`
 * returns everyone noted so far.
 */
const served = Effect.gen(function* () {
  const noted = yield* Ref.make<readonly Principal[]>([]);

  const note = CurrentPrincipal.use((caller) =>
    Ref.update(noted, (callers) => [...callers, caller])
  );

  const handlers = Layer.mergeAll(
    unanswered,
    Contracts.toLayerHandler("listAsks", () =>
      note.pipe(Effect.as({ asks: [] }))
    ),
    Contracts.toLayerHandler("status", () =>
      note.pipe(
        Effect.as({ answers: [], claims: [], handle: Handle.make("tester") })
      )
    )
  );

  const client = yield* RpcTest.makeClient(Contracts).pipe(
    Effect.provide(Layer.mergeAll(handlers, authenticated(verify)))
  );

  return { callers: Ref.get(noted), client };
});

describe("the server side of Authenticated", () => {
  it.effect("runs a public contract without a credential as anyone", () =>
    Effect.gen(function* () {
      const { callers, client } = yield* served;

      expect(yield* client.listAsks({ project })).toStrictEqual({ asks: [] });
      expect(yield* callers).toStrictEqual([Anonymous.make({})]);
    })
  );

  it.effect("refuses a signed-in contract without a credential", () =>
    Effect.gen(function* () {
      const { callers, client } = yield* served;

      expect(yield* Effect.flip(client.status({}))).toStrictEqual(
        new Unauthenticated()
      );
      expect(yield* callers).toStrictEqual([]);
    })
  );

  // `today` is for deciders: the handler checks who decides, but nobody
  // reaches it without a credential.
  it.effect("refuses a decider's contract without a credential", () =>
    Effect.gen(function* () {
      const { client } = yield* served;

      expect(yield* Effect.flip(client.today({ project }))).toStrictEqual(
        new Unauthenticated()
      );
    })
  );

  it.effect(
    "never takes an unknown credential for anyone, even on a public contract",
    () =>
      Effect.gen(function* () {
        const { callers, client } = yield* served;

        const refused = yield* Effect.flip(
          client.listAsks({ project }, bearer("mallory-token"))
        );

        expect(refused).toStrictEqual(new Unauthenticated());
        expect(yield* callers).toStrictEqual([]);
      })
  );

  it.effect("refuses a credential that is not a bearer token", () =>
    Effect.gen(function* () {
      const { callers, client } = yield* served;

      const refused = yield* Effect.flip(
        client.listAsks(
          { project },
          { headers: { authorization: "Basic YWxpY2UtdG9rZW4=" } }
        )
      );

      expect(refused).toStrictEqual(new Unauthenticated());
      expect(yield* callers).toStrictEqual([]);
    })
  );

  it.effect("runs every contract a known credential calls as its person", () =>
    Effect.gen(function* () {
      const { callers, client } = yield* served;

      yield* client.listAsks({ project }, bearer("alice-token"));
      yield* client.status({}, bearer("alice-token"));

      expect(yield* callers).toStrictEqual([alice, alice]);
    })
  );
});

describe(bearerToken, () => {
  it("reads the token whatever the scheme's case, and nothing from another scheme", () => {
    expect(
      [
        "Bearer alice-token",
        "bearer alice-token",
        "BEARER alice-token",
        "Basic YWxpY2U6dG9rZW4=",
        "Bearer",
        undefined,
      ].map(bearerToken)
    ).toStrictEqual([
      Option.some("alice-token"),
      Option.some("alice-token"),
      Option.some("alice-token"),
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
  });
});
