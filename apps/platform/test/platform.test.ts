import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { Effect, Layer, Redacted } from "effect";

import { decodeEnv, InvalidEnv, platform } from "../src/platform.ts";
import {
  emptyFrontPage,
  fakeEnv,
  masterKey,
  operatorToken,
  without,
} from "./fake-env.ts";
import { rpcClient, served, toolCall } from "./harness.ts";

const project = ProjectName.make("datekit");

/** What building the platform from `env` failed with. */
const failureOf = (env: Env) => Effect.flip(Layer.build(platform(env)));

describe("the platform Worker's env", () => {
  it.effect("lets the operator's token call the contracts", () =>
    Effect.gen(function* () {
      const prepared: string[] = [];

      const { handler } = yield* served(
        platform({ ...fakeEnv(), FRONT_PAGE: emptyFrontPage(prepared) })
      );

      const operator = yield* rpcClient(handler, operatorToken);

      expect(yield* operator.listProjects({})).toStrictEqual({
        projects: [],
      });
      // The projects come from the front page's projection in D1.
      expect(prepared).toHaveLength(1);
    })
  );

  it.effect("turns away any other token", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(platform(fakeEnv()));

      const response = yield* fetch(
        toolCall("listAsks", { project }, `${operatorToken}-not`)
      );

      expect(response.status).toBe(401);
    })
  );

  it.effect("fails to start without a usable operator token", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf({
        ...fakeEnv(),
        OPERATOR_TOKEN: "short",
      });

      expect(failure).toStrictEqual(
        new InvalidEnv({ keys: ["OPERATOR_TOKEN"] })
      );
      expect(JSON.stringify(failure)).not.toContain("short");
    })
  );

  it.effect("fails to start without its Artifacts binding", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(without(fakeEnv(), "ARTIFACTS"));

      expect(failure).toStrictEqual(new InvalidEnv({ keys: ["ARTIFACTS"] }));
    })
  );

  // OSR §5.1: layer repos live in a namespace of their own, which only
  // this Worker binds.
  it.effect("fails to start without the private namespace", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(without(fakeEnv(), "ARTIFACTS_PRIVATE"));

      expect(failure).toStrictEqual(
        new InvalidEnv({ keys: ["ARTIFACTS_PRIVATE"] })
      );
    })
  );

  it.effect(
    "fails to start without a master key of 64 hex characters, naming the key only",
    () =>
      Effect.gen(function* () {
        const missing = yield* failureOf(without(fakeEnv(), "MASTER_KEY"));

        const short = yield* failureOf({
          ...fakeEnv(),
          MASTER_KEY: masterKey.slice(2),
        });

        const notHex = yield* failureOf({
          ...fakeEnv(),
          MASTER_KEY: `${masterKey.slice(2)}zz`,
        });

        expect([missing, short, notHex]).toStrictEqual([
          new InvalidEnv({ keys: ["MASTER_KEY"] }),
          new InvalidEnv({ keys: ["MASTER_KEY"] }),
          new InvalidEnv({ keys: ["MASTER_KEY"] }),
        ]);
        expect(JSON.stringify([short, notHex])).not.toContain(
          masterKey.slice(2)
        );
      })
  );

  it.effect("keeps the master key redacted once decoded", () =>
    Effect.gen(function* () {
      const { MASTER_KEY } = yield* decodeEnv(fakeEnv());

      expect(Redacted.isRedacted(MASTER_KEY)).toBeTruthy();
      // A redacted value prints as its `toString`, never as the value.
      expect(JSON.stringify({ MASTER_KEY })).toBe(
        '{"MASTER_KEY":"<redacted>"}'
      );
      expect(Redacted.value(MASTER_KEY)).toBe(masterKey);
    })
  );

  it.effect("names every missing binding and var at once", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(
        without(without(fakeEnv(), "SANDBOX"), "STAGE")
      );

      expect(failure).toStrictEqual(
        new InvalidEnv({ keys: ["SANDBOX", "STAGE"] })
      );
    })
  );

  it.effect(
    "fails to start without sign-in's pepper, or with a short one, naming the key only",
    () =>
      Effect.gen(function* () {
        const missing = yield* failureOf(without(fakeEnv(), "PASSWORD_PEPPER"));

        const short = yield* failureOf({
          ...fakeEnv(),
          PASSWORD_PEPPER: "short-pepper",
        });

        expect([missing, short]).toStrictEqual([
          new InvalidEnv({ keys: ["PASSWORD_PEPPER"] }),
          new InvalidEnv({ keys: ["PASSWORD_PEPPER"] }),
        ]);
        expect(JSON.stringify(short)).not.toContain("short-pepper");
      })
  );

  it.effect(
    "fails to start on a session table it cannot read, without printing it",
    () =>
      Effect.gen(function* () {
        const env = {
          ...fakeEnv(),
          SESSION_TOKENS: JSON.stringify({ "short-token": "alice" }),
        };

        const failure = yield* failureOf(env);

        expect(failure).toStrictEqual(
          new InvalidEnv({ keys: ["SESSION_TOKENS"] })
        );
        expect(JSON.stringify(failure)).not.toContain("short-token");
      })
  );

  it.effect("lets a token from the session table call as its person", () =>
    Effect.gen(function* () {
      const token = "alice-token-0123456789abcdef01234567";

      const env = {
        ...fakeEnv(),
        FRONT_PAGE: emptyFrontPage(),
        SESSION_TOKENS: JSON.stringify({ [token]: "alice" }),
      };

      const { handler } = yield* served(platform(env));

      const alice = yield* rpcClient(handler, token);

      expect(yield* alice.listProjects({})).toStrictEqual({ projects: [] });
    })
  );

  it.effect("lands with the container Lander unless the env says isogit", () =>
    Effect.gen(function* () {
      const unset = yield* decodeEnv(without(fakeEnv(), "LANDER_ADAPTER"));

      const isogit = yield* decodeEnv({
        ...fakeEnv(),
        LANDER_ADAPTER: "isogit",
      });

      expect([unset.LANDER_ADAPTER, isogit.LANDER_ADAPTER]).toStrictEqual([
        "container",
        "isogit",
      ]);
    })
  );

  it.effect("answers /health with its stage, without a credential", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(platform(fakeEnv()));

      const response = yield* fetch(new Request("http://localhost/health"));

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toStrictEqual({
        ok: true,
        stage: "local",
      });
    })
  );

  it.effect("hands git's paths to the gateway, outside the 401 gate", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(platform(fakeEnv()));

      // A name the platform never makes (spec §4.5): the gateway answers
      // before any port, and nobody is asked to sign in.
      const response = yield* fetch(
        new Request(
          "http://localhost/datekit--layer--alice.git/info/refs?service=git-upload-pack"
        )
      );

      expect(response.status).toBe(404);
    })
  );
});
