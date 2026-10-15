import { describe, expect, it } from "@effect/vitest";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

import { backend } from "#backend";

import { serverClientOver } from "../src/server/client.ts";
import { SESSION_COOKIE, whoamiHandler } from "../src/server/session.ts";
import { DECIDER, WEB_URL, seededWorld } from "./dev-browser.ts";

describe("a browser's session, through the web", seededWorld, () => {
  it.live(
    "signs a browser in as the person whose dev token its session cookie holds, as /auth/dev sets it",
    () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          whoamiHandler(env, (request) =>
            serverClientOver(backend)(env, request)
          )({
            request: new Request(`${WEB_URL}/auth/whoami`, {
              headers: { cookie: `${SESSION_COOKIE}=${DECIDER}` },
            }),
          })
        );

        expect(
          JSON.parse(yield* Effect.promise(() => response.text()))
        ).toStrictEqual({ handle: "ines-v" });
      })
  );
});
