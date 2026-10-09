/**
 * The code browser's, the people page's and drafting's contracts and
 * routes, wired end to end through the platform's fetch
 * handler before their bodies exist: the policy read answers, each code
 * read reaches the façade (which names the issue that builds it), a draft
 * needs a person, and `/` and a project's raw files have their slots, open
 * to a stale credential as every public path is.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProposalId } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { Handlers } from "../src/handlers.ts";
import { MemorySessions } from "../src/sessions/memory.ts";
import { seeded, worldOf } from "./handlers.fixtures.ts";
import { origin, rpcClient, served } from "./harness.ts";

const datekit = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = datekit;

const sessions = MemorySessions.layer({});

/** The platform over datekit's world, seeded: made, pushed to, its ask open. */
const platform = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const world = yield* Layer.build(worldOf([datekit]));

  yield* seeded(datekit).pipe(Effect.provide(world));

  const ports = Layer.succeedContext(world);

  return yield* served(
    Layer.mergeAll(Handlers.pipe(Layer.provide(ports)), ports, sessions)
  );
});

/** What a call died with, as text; none when it did not die. */
const diedWith = <A, E>(call: Effect.Effect<A, E>) =>
  Effect.map(Effect.exit(call), (exit) =>
    Exit.isFailure(exit) && Cause.hasDies(exit.cause)
      ? Option.some(String(Cause.squash(exit.cause)))
      : Option.none()
  );

describe("the code, policy and drafting contracts over /rpc", () => {
  it.effect("give anyone a project's policy, without its layers", () =>
    Effect.gen(function* () {
      const { handler } = yield* platform;
      const anyone = yield* rpcClient(handler);

      const { policy } = yield* anyone.projectPolicy({ project });

      expect(policy?.source).toBe("config");
      expect(policy?.deciders).toStrictEqual(datekit.policy.deciders);
      expect(Object.keys(policy ?? {})).not.toContain("visibility");
      expect(Object.keys(policy ?? {})).not.toContain("asks");
    })
  );

  it.effect("reach the code façade, which names the issue that builds it", () =>
    Effect.gen(function* () {
      const { handler } = yield* platform;
      const anyone = yield* rpcClient(handler);

      expect(yield* diedWith(anyone.listRefs({ project }))).toStrictEqual(
        Option.some("not built: 903")
      );
      expect(yield* diedWith(anyone.readTree({ project }))).toStrictEqual(
        Option.some("not built: 903")
      );
    })
  );

  it.effect("refuse a draft to anyone not signed in", () =>
    Effect.gen(function* () {
      const { handler } = yield* platform;
      const anyone = yield* rpcClient(handler);

      expect(
        yield* Effect.exit(
          anyone.draftAsk({
            project,
            proposal: ProposalId.make("prop-000001"),
          })
        )
      ).toStrictEqual(Exit.fail(new Unauthenticated()));
    })
  );
});

describe("the host page and raw files routes", () => {
  it.effect(
    "answer / and a project's raw files from their slots, a stale bearer or not",
    () =>
      Effect.gen(function* () {
        const { fetch } = yield* platform;

        const stale = {
          authorization: "Bearer not-a-token-the-platform-knows",
        };

        const read = (path: string, headers: Record<string, string> = {}) =>
          Effect.flatMap(
            fetch(new Request(`${origin}${path}`, { headers })),
            (response) =>
              Effect.map(
                Effect.promise(() => response.text()),
                (text) => ({ status: response.status, text })
              )
          );

        const raw = `/${project}/raw/${"4".repeat(40)}/README.md`;

        expect({
          home: yield* read("/"),
          homeStale: yield* read("/", stale),
          raw: yield* read(raw),
          rawStale: yield* read(raw, stale),
        }).toStrictEqual({
          home: {
            status: 501,
            text: "not built: 906 (draft model test-model)",
          },
          homeStale: {
            status: 501,
            text: "not built: 906 (draft model test-model)",
          },
          raw: { status: 501, text: "not built: 903" },
          rawStale: { status: 501, text: "not built: 903" },
        });
      })
  );

  it.effect("leaves git's own paths to git, beside the raw route", () =>
    Effect.gen(function* () {
      const { fetch } = yield* platform;

      const response = yield* fetch(
        new Request(`${origin}/${project}/raw/info/refs`)
      );

      expect(response.status).toBe(501);
      expect(yield* Effect.promise(() => response.text())).toBe(
        "not built: 903"
      );
    })
  );
});
