import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import { EDGE_STALE_SECONDS } from "../src/server/edge-cache.ts";
import { keptKeyOf, servedKept } from "../src/server/kept-pages.ts";
import type { KeptPage, PageKeeper } from "../src/server/kept-pages.ts";
import { SESSION_COOKIE } from "../src/server/session.ts";

const WEB_URL = "https://web-test.example.workers.dev";

const AGENT_PAGE = { "cache-control": "public, max-age=60" } as const;

const get = (path: string, headers: HeadersInit = {}) =>
  new Request(`${WEB_URL}${path}`, { headers });

/** A keeper in memory whose background work waits until the test runs it. */
const memoryKeeper = Effect.gen(function* () {
  const pages = yield* Ref.make<ReadonlyMap<string, KeptPage>>(new Map());
  const pending = yield* Ref.make<readonly Effect.Effect<void>[]>([]);

  const keeper: PageKeeper = {
    get: (key) =>
      Effect.map(Ref.get(pages), (all) => Option.fromUndefinedOr(all.get(key))),
    inBackground: (work) => Ref.update(pending, (all) => [...all, work]),
    put: (key, page) =>
      Ref.update(pages, (all) => new Map([...all, [key, page]])),
  };

  // Work queued by work in the background runs too, as `waitUntil` would.
  const runBackground: Effect.Effect<void> = Effect.flatMap(
    Ref.getAndSet(pending, []),
    (queued) =>
      queued.length === 0
        ? Effect.void
        : Effect.andThen(
            Effect.forEach(queued, (work) => work, { discard: true }),
            Effect.suspend(() => runBackground)
          )
  );

  return { keeper, pages, pending, runBackground };
});

/** The route: each read answers the next version of the page, and is counted. */
const countedRoute = (
  headers: Readonly<Record<string, string>> = AGENT_PAGE,
  status = 200
) =>
  Effect.map(Ref.make(0), (reads) => ({
    reads,
    render: Effect.map(
      Ref.updateAndGet(reads, (n) => n + 1),
      (n) =>
        new Response(`version ${n}`, {
          headers: { ...headers, "content-type": "text/markdown" },
          status,
        })
    ),
  }));

const bodyOf = (response: Response) => Effect.promise(() => response.text());

describe("an agent's page, kept by the Worker", () => {
  it.effect(
    "is read from the platform once while it is fresh, and kept by its path alone",
    () =>
      Effect.gen(function* () {
        const { keeper, pages, runBackground } = yield* memoryKeeper;
        const { reads, render } = yield* countedRoute();
        const served = servedKept(keeper);

        const first = yield* bodyOf(yield* served(get("/llms.txt"), render));
        yield* runBackground;
        yield* TestClock.adjust("59 seconds");

        const second = yield* bodyOf(
          yield* served(get("/llms.txt?again"), render)
        );

        expect({
          first,
          kept: [...(yield* Ref.get(pages)).keys()],
          reads: yield* Ref.get(reads),
          second,
        }).toStrictEqual({
          first: "version 1",
          kept: [keptKeyOf(get("/llms.txt"))],
          reads: 1,
          second: "version 1",
        });
      })
  );

  it.effect(
    "is answered at once from what was kept once it has expired, and read again only in the background",
    () =>
      Effect.gen(function* () {
        const { keeper, pending, runBackground } = yield* memoryKeeper;
        const { reads, render } = yield* countedRoute();
        const served = servedKept(keeper);

        yield* served(get("/oscabriel/datekit/llms.txt"), render);
        yield* runBackground;
        yield* TestClock.adjust("2 minutes");

        const stale = yield* served(get("/oscabriel/datekit/llms.txt"), render);

        // The answer has gone before the platform is asked again.
        const readsWhenAnswered = yield* Ref.get(reads);
        const waiting = (yield* Ref.get(pending)).length;

        yield* runBackground;

        const after = yield* served(get("/oscabriel/datekit/llms.txt"), render);

        expect({
          after: yield* bodyOf(after),
          cacheControl: stale.headers.get("cache-control"),
          contentType: stale.headers.get("content-type"),
          reads: yield* Ref.get(reads),
          readsWhenAnswered,
          stale: yield* bodyOf(stale),
          waiting,
        }).toStrictEqual({
          after: "version 2",
          cacheControl: AGENT_PAGE["cache-control"],
          contentType: "text/markdown",
          reads: 2,
          readsWhenAnswered: 1,
          stale: "version 1",
          waiting: 1,
        });
      })
  );

  it.effect(
    "is read again before it is answered once it is older than the edge's stale window",
    () =>
      Effect.gen(function* () {
        const { keeper, runBackground } = yield* memoryKeeper;
        const { reads, render } = yield* countedRoute();
        const served = servedKept(keeper);

        yield* served(get("/llms.txt"), render);
        yield* runBackground;
        yield* TestClock.adjust(`${60 + EDGE_STALE_SECONDS + 1} seconds`);

        const late = yield* bodyOf(yield* served(get("/llms.txt"), render));

        expect({ late, reads: yield* Ref.get(reads) }).toStrictEqual({
          late: "version 2",
          reads: 2,
        });
      })
  );

  it.effect.each([
    ["a session cookie", { cookie: `${SESSION_COOKIE}=dev-ada` }],
    ["any cookie", { cookie: "theme=dark" }],
    ["an Authorization", { authorization: "Bearer token" }],
  ] as const)(
    "is neither kept nor handed back for a request with %s",
    ([, headers]) =>
      Effect.gen(function* () {
        const { keeper, pages, runBackground } = yield* memoryKeeper;
        const { reads, render } = yield* countedRoute();
        const served = servedKept(keeper);

        yield* served(get("/llms.txt"), render);
        yield* runBackground;

        const asked = yield* bodyOf(
          yield* served(get("/llms.txt", headers), render)
        );

        yield* runBackground;

        const keptBeforeSecond = (yield* Ref.get(pages)).size;

        yield* Ref.set(pages, new Map());
        yield* served(get("/llms.txt", headers), render);
        yield* runBackground;

        expect({
          asked,
          keptAfter: (yield* Ref.get(pages)).size,
          keptBeforeSecond,
          reads: yield* Ref.get(reads),
        }).toStrictEqual({
          asked: "version 2",
          keptAfter: 0,
          keptBeforeSecond: 1,
          reads: 3,
        });
      })
  );

  it.effect.each([
    ["the platform did not answer", { "cache-control": "no-store" }, 503],
    ["a page not found", AGENT_PAGE, 404],
    ["an answer kept by nobody", { "cache-control": "private, no-store" }, 200],
    ["an answer with no age", { "cache-control": "public" }, 200],
    [
      "an answer that forbids serving it stale",
      { "cache-control": "public, max-age=60, must-revalidate" },
      200,
    ],
    [
      "an answer that sets a cookie",
      { ...AGENT_PAGE, "set-cookie": "a=b" },
      200,
    ],
  ] as const)("keeps nothing when %s", ([, headers, status]) =>
    Effect.gen(function* () {
      const { keeper, pages, runBackground } = yield* memoryKeeper;
      const { reads, render } = yield* countedRoute(headers, status);
      const served = servedKept(keeper);

      const first = yield* served(get("/llms.txt"), render);
      yield* runBackground;
      yield* served(get("/llms.txt"), render);

      expect({
        kept: (yield* Ref.get(pages)).size,
        reads: yield* Ref.get(reads),
        status: first.status,
      }).toStrictEqual({ kept: 0, reads: 2, status });
    })
  );
});

describe("the agents' routes", () => {
  const routes: Readonly<Record<string, string>> = import.meta.glob(
    "../src/routes/**/*.ts",
    { eager: true, import: "default", query: "?raw" }
  );

  it.each([
    "../src/routes/llms[.]txt.ts",
    "../src/routes/$owner/$project/llms[.]txt.ts",
    "../src/routes/$owner/$project/asks/{$ask}[.]md.ts",
    "../src/routes/[.]well-known/agent-skills/$.ts",
  ])("keep each answer to a GET by the Worker: %s", (path) => {
    expect(routes[path]).toMatch(/GET: keptPage\(/u);
  });
});
