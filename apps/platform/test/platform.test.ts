import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { Effect, Layer } from "effect";

import { InvalidEnv, platform } from "../src/platform.ts";
import { rpcClient, served, toolCall } from "./harness.ts";

const token = "operator-token-0123456789abcdef0123";

const env: Env = { OPERATOR_HANDLE: "oscabriel", OPERATOR_TOKEN: token };

const project = ProjectName.make("datekit");

describe("the platform Worker's env", () => {
  it.effect("lets the operator's token call the contracts", () =>
    Effect.gen(function* () {
      const { handler } = yield* served(platform(env));

      const operator = yield* rpcClient(handler, token);

      expect(yield* operator.listProjects({})).toStrictEqual({
        projects: [],
      });
    })
  );

  it.effect("turns away any other token", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(platform(env));

      const response = yield* fetch(
        toolCall("listAsks", { project }, `${token}-not`)
      );

      expect(response.status).toBe(401);
    })
  );

  it.effect("fails to start without a usable operator token", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Layer.build(platform({ ...env, OPERATOR_TOKEN: "short" }))
      );

      expect(failure).toStrictEqual(
        new InvalidEnv({ keys: ["OPERATOR_TOKEN"] })
      );
      expect(JSON.stringify(failure)).not.toContain("short");
    })
  );
});
