/**
 * The web's `/rpc`: the route hands each request to a backend with the
 * Worker's env, and the production backend forwards it to the platform over
 * `PLATFORM`, at the platform's own URL (so the remotes the platform names,
 * read from the request's origin, are its own; W3 312 #2), keeping method,
 * headers and body, but never the browser's cookies (the session cookie
 * becomes a bearer there: `session.test.ts`, issue 513). A server route's
 * own calls go through the same backend, in process.
 */
import { describe, expect, it } from "@effect/vitest";
import { Client } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Exit, Schema } from "effect";

import { backend } from "../src/server/backend.ts";
import { serverClientOver } from "../src/server/client.ts";
import { rpcHandler } from "../src/server/rpc.ts";
import type { Backend } from "../src/server/rpc.ts";

const PLATFORM_URL = "https://platform-test.example.workers.dev";

const WEB_URL = "https://web-test.example.workers.dev";

const LIST_ASKS =
  '[{"_tag":"Request","id":"0","tag":"listAsks","payload":{"project":"datekit"},"headers":[]}]';

/** What a backend or a binding was handed, read whole. */
const seenOf = (request: Request) =>
  Effect.map(
    Effect.promise(() => request.text()),
    (body) => ({
      authorization: request.headers.get("authorization"),
      body,
      contentType: request.headers.get("content-type"),
      cookie: request.headers.get("cookie"),
      method: request.method,
      url: request.url,
    })
  );

/** A fetch-shaped stub that keeps each request it is handed and answers `answer`. */
const recorder = (answer: () => Response) => {
  const handed: Request[] = [];

  const fetch = (request: Request) => {
    handed.push(request);

    return Promise.resolve(answer());
  };

  return { fetch, seen: Effect.suspend(() => Effect.forEach(handed, seenOf)) };
};

/** A web Worker env whose PLATFORM binding answers `fetch` and nothing else. */
const envWith = (fetch: (request: Request) => Promise<Response>): Env => ({
  PLATFORM: untouchable<Fetcher>("PLATFORM", {
    fetch: (input, init) => fetch(new Request(input, init)),
  }),
  PUBLIC_PLATFORM_URL: PLATFORM_URL,
});

const unused = envWith(() => Promise.resolve(new Response("unused")));

/** A `listAsks` call as the browser's AtomRpc client posts it. */
const listAsksPost = (headers: Readonly<Record<string, string>> = {}) =>
  new Request(`${WEB_URL}/rpc`, {
    body: LIST_ASKS,
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

describe("the /rpc route's handler", () => {
  it.effect("hands the request to the backend it was given, with the env", () =>
    Effect.gen(function* () {
      const envs: Env[] = [];
      const stub = recorder(() => new Response("answered"));

      const given: Backend = (request, env) => {
        envs.push(env);

        return stub.fetch(request);
      };

      const response = yield* Effect.promise(() =>
        rpcHandler(given, unused)({ request: listAsksPost() })
      );

      expect(envs).toStrictEqual([unused]);
      expect(yield* stub.seen).toStrictEqual([
        {
          authorization: null,
          body: LIST_ASKS,
          contentType: "application/json",
          cookie: null,
          method: "POST",
          url: `${WEB_URL}/rpc`,
        },
      ]);
      expect(yield* Effect.promise(() => response.text())).toBe("answered");
    })
  );
});

describe("the production backend", () => {
  it.effect(
    "forwards to PLATFORM at the platform's URL, keeping method, headers and body, but not the browser's cookies",
    () =>
      Effect.gen(function* () {
        const platform = recorder(() => new Response("from the platform"));

        const response = yield* Effect.promise(() =>
          backend(
            listAsksPost({ cookie: "theme=dark" }),
            envWith(platform.fetch)
          )
        );

        expect(yield* platform.seen).toStrictEqual([
          {
            authorization: null,
            body: LIST_ASKS,
            contentType: "application/json",
            cookie: null,
            method: "POST",
            url: `${PLATFORM_URL}/rpc`,
          },
        ]);
        expect(yield* Effect.promise(() => response.text())).toBe(
          "from the platform"
        );
      })
  );

  it.effect("keeps the path and the query on the platform's origin", () =>
    Effect.gen(function* () {
      const platform = recorder(() => new Response("ok"));

      yield* Effect.promise(() =>
        backend(
          new Request(`${WEB_URL}/releases/x?y=1`),
          envWith(platform.fetch)
        )
      );

      const seen = yield* platform.seen;

      expect(seen.map(({ method, url }) => [method, url])).toStrictEqual([
        ["GET", `${PLATFORM_URL}/releases/x?y=1`],
      ]);
    })
  );
});

describe("a server route's client", () => {
  it.effect(
    "posts each call to /rpc through the backend, in process, with the caller's cookie",
    () =>
      Effect.gen(function* () {
        const stub = recorder(
          () => new Response("not an rpc answer", { status: 500 })
        );

        const given: Backend = (request) => stub.fetch(request);

        const exit = yield* Effect.service(Client).pipe(
          Effect.flatMap((client) =>
            client.listAsks({
              project: Schema.decodeSync(ProjectName)("datekit"),
            })
          ),
          Effect.provide(
            serverClientOver(given)(
              unused,
              listAsksPost({ cookie: "session=abc" })
            )
          ),
          Effect.exit
        );

        const seen = yield* stub.seen;

        expect(Exit.isFailure(exit)).toBeTruthy();
        expect(
          seen.map(({ body, contentType, cookie, method, url }) => ({
            body: body.includes('"tag":"listAsks"'),
            contentType,
            cookie,
            method,
            // Effect's HTTP protocol posts to its URL with a trailing slash.
            path: new URL(url).pathname.replace(/\/$/u, ""),
          }))
        ).toStrictEqual([
          {
            body: true,
            contentType: "application/json",
            cookie: "session=abc",
            method: "POST",
            path: "/rpc",
          },
        ]);
        expect(new URL(seen[0]?.url ?? "").origin).toBe(WEB_URL);
      })
  );
});

describe("the /rpc route", () => {
  it.effect("answers POST with the backend's handler, and nothing else", () =>
    Effect.gen(function* () {
      const { Route } = yield* Effect.promise(
        () => import("../src/routes/rpc.ts")
      );

      expect(Object.keys(Route.options.server?.handlers ?? {})).toStrictEqual([
        "POST",
      ]);
    })
  );
});
