/**
 * The code browser's, the people page's and drafting's contracts and
 * routes, wired end to end through the platform's fetch
 * handler: the policy read answers, the code reads reach the façade
 * (`why` here; the others are `code-reads.test.ts`'), a draft needs a
 * person, and `/` and a project's
 * raw files have their routes, open to a stale credential as every public
 * path is (a raw file at no revision is a 404).
 */
import { describe, expect, it } from "@effect/vitest";
import { ProposalId, RepoPath } from "@repo/protocol/ids";
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

  it.effect("reach the code façade, whose why answers without dying", () =>
    Effect.gen(function* () {
      const { handler } = yield* platform;
      const anyone = yield* rpcClient(handler);

      expect(
        yield* diedWith(
          anyone.why({ path: RepoPath.make("package.json"), project })
        )
      ).toStrictEqual(Option.none());
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
          home: (yield* read("/")).status,
          homeStale: (yield* read("/", stale)).status,
          raw: yield* read(raw),
          rawStale: yield* read(raw, stale),
        }).toStrictEqual({
          home: 200,
          homeStale: 200,
          raw: { status: 404, text: "" },
          rawStale: { status: 404, text: "" },
        });
      })
  );

  it.effect("leaves git's own paths to git, beside the raw route", () =>
    Effect.gen(function* () {
      const { fetch } = yield* platform;

      const response = yield* fetch(
        new Request(`${origin}/${project}/raw/info/refs`)
      );

      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => response.text())).toBe("");
    })
  );
});
