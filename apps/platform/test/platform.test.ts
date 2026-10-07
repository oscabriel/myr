import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { Effect, Layer } from "effect";

import { decodeEnv, InvalidEnv, platform } from "../src/platform.ts";
import { fakeEnv, operatorToken, without } from "./fake-env.ts";
import { rpcClient, served, toolCall } from "./harness.ts";

const project = ProjectName.make("datekit");

const cookieKey = "cookie-key-0123456789abcdef0123456789";

const clientId = "github-client-id-0123";

/** What building the platform from `env` failed with. */
const failureOf = (env: Env) => Effect.flip(Layer.build(platform(env)));

describe("the platform Worker's env", () => {
  it.effect("lets the operator's token call the contracts", () =>
    Effect.gen(function* () {
      const { handler } = yield* served(platform(fakeEnv()));

      const operator = yield* rpcClient(handler, operatorToken);

      expect(yield* operator.listProjects({})).toStrictEqual({
        projects: [],
      });
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
    "fails to start with GitHub's client id but not its secret, naming the key only",
    () =>
      Effect.gen(function* () {
        const env = {
          ...fakeEnv(),
          COOKIE_KEY: cookieKey,
          GITHUB_CLIENT_ID: clientId,
        };

        const failure = yield* failureOf(env);

        expect(failure).toStrictEqual(
          new InvalidEnv({ keys: ["GITHUB_CLIENT_SECRET"] })
        );
        expect(JSON.stringify(failure)).not.toContain(clientId);
        expect(JSON.stringify(failure)).not.toContain(cookieKey);
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

      const response = yield* fetch(
        new Request(
          "http://localhost/datekit.git/info/refs?service=git-upload-pack"
        )
      );

      // No gateway yet (303): no repo answers, and nobody is asked to sign in.
      expect(response.status).toBe(404);
    })
  );
});
