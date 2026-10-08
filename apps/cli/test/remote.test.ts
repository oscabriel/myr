import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import { AskId, Handle, KindName } from "@repo/protocol/ids";
import { unanswered } from "@repo/protocol/testing";
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect";

import { Credentials } from "../src/credentials.ts";
import type { Profile } from "../src/credentials.ts";
import { RemoteClient } from "../src/remote.ts";
import {
  failingPlatform,
  httpPlatform,
  knownToken,
  runProgram,
} from "./remote-server.ts";
import type { Handlers } from "./remote-server.ts";

/** `listAsks` (public) lists one ask; `status` (signed in) shows nothing yet. */
const handlers: Handlers = Layer.mergeAll(
  unanswered,
  Contracts.toLayerHandler("listAsks", () =>
    Effect.succeed({
      asks: [
        {
          ask: AskId.make("fix-week"),
          blockedBy: [],
          claimed: false,
          kind: KindName.make("fix"),
          territory: "packages/week",
          want: "Weeks start on the locale's first day",
        },
      ],
    })
  ),
  Contracts.toLayerHandler("status", () =>
    Effect.succeed({ answers: [], claims: [], handle: Handle.make("tester") })
  )
);

/** Credentials holding `profile`, or none. */
const holding = (profile: Option.Option<Profile>) =>
  Layer.succeed(Credentials)({
    current: Effect.succeed(profile),
    forHost: () => Effect.succeed(profile),
    put: () => Effect.void,
    remove: () => Effect.succeed(false),
  });

const profileOn = (url: string, token: string): Profile => ({
  token: Redacted.make(token),
  url,
});

/** The remote client over `credentials`, with `env` as its whole env. */
const remote = (
  credentials: Layer.Layer<Credentials>,
  env: Readonly<Record<string, string>> = {}
) =>
  RemoteClient.pipe(
    Layer.provide([
      credentials,
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...env } })),
    ])
  );

const urlVariable = `${Brand.slug.toUpperCase()}_URL`;

const signIn = `next: ${Brand.cli} login`;

describe("the remote client", () => {
  it.live("sends the stored profile's token as the HTTP bearer", () =>
    Effect.gen(function* () {
      const platform = yield* httpPlatform(handlers);

      const run = yield* runProgram(["status", "--json"], {
        client: remote(
          holding(Option.some(profileOn(platform.origin, knownToken)))
        ),
        handlers,
      });

      expect(run.code).toBe(0);
      expect(yield* platform.seen).toStrictEqual([`Bearer ${knownToken}`]);
    }).pipe(Effect.scoped)
  );

  it.live("status says whom the platform takes the caller for", () =>
    Effect.gen(function* () {
      const platform = yield* httpPlatform(handlers);

      const run = yield* runProgram(["status"], {
        client: remote(
          holding(Option.some(profileOn(platform.origin, knownToken)))
        ),
        handlers,
      });

      expect(run.code).toBe(0);
      expect(run.out[0]).toBe("Signed in as tester.");
    }).pipe(Effect.scoped)
  );

  it.live(
    "without a profile sends no credential: a public contract answers, a signed-in one says to log in",
    () =>
      Effect.gen(function* () {
        const platform = yield* httpPlatform(handlers);

        const client = remote(holding(Option.none()), {
          [urlVariable]: platform.origin,
        });

        const asks = yield* runProgram(["asks", "--project", "datekit"], {
          client,
          handlers,
        });

        const status = yield* runProgram(["status"], { client, handlers });

        expect([asks.code, status.code]).toStrictEqual([0, 1]);
        expect(asks.out.join("\n")).toContain("fix-week");
        expect(status.err.join("\n")).toContain(signIn);
        expect(status.out).toStrictEqual([]);
        expect(yield* platform.seen).toStrictEqual([undefined, undefined]);
      }).pipe(Effect.scoped)
  );

  it.live("turns a 401 into the same words, not a stack trace", () =>
    Effect.gen(function* () {
      const platform = yield* httpPlatform(handlers);

      const run = yield* runProgram(["status"], {
        client: remote(
          holding(Option.some(profileOn(platform.origin, "a-stale-token")))
        ),
        handlers,
      });

      expect(run.code).toBe(1);
      expect(run.err).toStrictEqual([
        "Unauthenticated: the platform does not know who you are",
        `  ${signIn}`,
        "  retryable: no",
      ]);
    }).pipe(Effect.scoped)
  );

  it.live(
    "says in one line what failed when the platform answers with an error",
    () =>
      Effect.gen(function* () {
        const origin = yield* failingPlatform(503);

        const run = yield* runProgram(["asks", "--project", "datekit"], {
          client: remote(holding(Option.none()), { [urlVariable]: origin }),
          handlers,
        });

        expect(run.code).toBe(1);
        expect(run.out).toStrictEqual([]);
        expect(run.err).toHaveLength(1);
        expect(run.err[0]).toMatch(/^could not reach the platform: .*\b503\b/u);
        expect(run.err[0]).toContain(`${origin}/rpc`);
      }).pipe(Effect.scoped)
  );

  it.live("with no profile and no url, is a usage error naming login", () =>
    Effect.gen(function* () {
      const run = yield* runProgram(["asks", "--project", "datekit"], {
        client: remote(holding(Option.none())),
        handlers,
      });

      expect(run.code).toBe(2);
      expect(run.err).toHaveLength(1);
      expect(run.err[0]).toContain(`${Brand.cli} login`);
    })
  );
});
