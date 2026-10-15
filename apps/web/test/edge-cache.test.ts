import { describe, expect, it } from "@effect/vitest";
import { Client, Contracts } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import { asTester, unanswered } from "@repo/protocol/testing";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/rpc";

import { forwarded } from "../src/features/agents/forward.ts";
import { backend } from "../src/server/backend.ts";
import { branchPage, personalPage } from "../src/server/cache-headers.ts";
import {
  EDGE_STALE_SECONDS,
  edgeEntry,
  forTheEdge,
  KEPT_NOWHERE,
} from "../src/server/edge-cache.ts";
import { frontPageHandler, landingHandler } from "../src/server/front-page.ts";
import { frontLlmsHandler, projectLlmsHandler } from "../src/server/llms.ts";
import { rpcHandler } from "../src/server/rpc.ts";
import { SESSION_COOKIE } from "../src/server/session.ts";

const WEB_URL = "https://web-test.example.workers.dev";

const PLATFORM_URL = "https://platform-test.example.workers.dev";

const SIGNED_IN = `${SESSION_COOKIE}=dev-ada`;

const get = (path: string, headers: HeadersInit = {}) =>
  new Request(`${WEB_URL}${path}`, { headers });

const kept = (response: Response) => ({
  cacheControl: response.headers.get("cache-control"),
  vary: response.headers.get("vary"),
});

const answer = (headers: HeadersInit, status = 200) =>
  new Response("the page", { headers, status });

const ANSWERS: readonly (readonly [string, HeadersInit])[] = [
  ["a page at main", branchPage],
  ["a page about its reader", personalPage],
  ["an agent's document", { "cache-control": "public, max-age=60" }],
  [
    "a raw file at a commit",
    { "cache-control": "public, max-age=31536000, immutable" },
  ],
  ["a sign-in redirect", { "cache-control": "no-store" }],
  ["an answer with no Cache-Control", {}],
];

describe("an answer to a request that says who is reading", () => {
  it.each(ANSWERS)(
    "is kept nowhere, given a session cookie: %s",
    (_, headers) => {
      expect(
        kept(
          forTheEdge(
            get("/oscabriel/datekit", { cookie: SIGNED_IN }),
            answer(headers)
          )
        ).cacheControl
      ).toBe(KEPT_NOWHERE);
    }
  );

  it.each(ANSWERS)("is kept nowhere, given any cookie: %s", (_, headers) => {
    expect(
      kept(
        forTheEdge(
          get("/oscabriel/datekit", { cookie: "theme=dark" }),
          answer(headers)
        )
      ).cacheControl
    ).toBe(KEPT_NOWHERE);
  });

  it.each(ANSWERS)(
    "is kept nowhere, given an Authorization: %s",
    (_, headers) => {
      expect(
        kept(
          forTheEdge(
            get("/oscabriel/datekit", { authorization: "Bearer dev-ada" }),
            answer(headers)
          )
        ).cacheControl
      ).toBe(KEPT_NOWHERE);
    }
  );
});

describe("an answer to a request with no cookie", () => {
  it("is kept nowhere when it sets a cookie", () => {
    expect(
      kept(
        forTheEdge(
          get("/auth/whoami"),
          answer({
            ...branchPage,
            "set-cookie": `${SESSION_COOKIE}=; Max-Age=0`,
          })
        )
      ).cacheControl
    ).toBe(KEPT_NOWHERE);
  });

  it("is kept nowhere when it says nothing of how long it may be kept", () => {
    // Without it, the cache would keep a 200 for two hours by its heuristic.
    expect(kept(forTheEdge(get("/_serverFn/x"), answer({})))).toStrictEqual({
      cacheControl: KEPT_NOWHERE,
      vary: null,
    });
  });

  it.each([`private="set-cookie"`, `public, no-cache="set-cookie"`])(
    "is kept nowhere when its Cache-Control names a field to strip: %s",
    (cacheControl) => {
      expect(
        kept(forTheEdge(get("/"), answer({ "cache-control": cacheControl })))
          .cacheControl
      ).toBe(KEPT_NOWHERE);
    }
  );

  it("keeps a page at main as the route says, varied by Cookie", () => {
    expect(
      kept(forTheEdge(get("/oscabriel/datekit/tree/main"), answer(branchPage)))
    ).toStrictEqual({
      cacheControl: branchPage["Cache-Control"],
      vary: "Cookie",
    });
  });

  it("adds Cookie to what an answer already varies by, once", () => {
    expect(
      [
        { ...branchPage, vary: "Accept" },
        { ...branchPage, vary: "Accept, cookie" },
      ].map((headers) => kept(forTheEdge(get("/"), answer(headers))).vary)
    ).toStrictEqual(["Accept, Cookie", "Accept, cookie"]);
  });

  it("keeps a page about its reader nowhere, as the route says", () => {
    expect(kept(forTheEdge(get("/inbox"), answer(personalPage)))).toStrictEqual(
      {
        cacheControl: personalPage["Cache-Control"],
        vary: null,
      }
    );
  });

  it("drops the headers that would outrank Cache-Control at the edge", () => {
    const response = forTheEdge(
      get("/releases/manifest.json"),
      answer({
        ...branchPage,
        "cdn-cache-control": "public, max-age=86400",
        "cloudflare-cdn-cache-control": "public, max-age=86400",
      })
    );

    expect([
      response.headers.get("cdn-cache-control"),
      response.headers.get("cloudflare-cdn-cache-control"),
    ]).toStrictEqual([
      null,
      `public, max-age=30, stale-while-revalidate=${EDGE_STALE_SECONDS}`,
    ]);
  });

  it.each([
    ["a page at main", branchPage, "public, max-age=30"],
    [
      "an agent's document",
      { "cache-control": "public, max-age=60" },
      "public, max-age=60",
    ],
  ] as const)(
    "serves %s stale at the edge for a day while it reads it again, and tells the browser what the route said",
    (_, headers, fresh) => {
      const response = forTheEdge(get("/oscabriel/datekit"), answer(headers));

      expect({
        browser: response.headers.get("cache-control"),
        edge: response.headers.get("cloudflare-cdn-cache-control"),
      }).toStrictEqual({
        browser: new Headers(headers).get("cache-control"),
        edge: `${fresh}, stale-while-revalidate=86400`,
      });
    }
  );

  it.each([
    ["a page about its reader", get("/inbox"), answer(personalPage)],
    [
      "a page asked for with a session",
      get("/oscabriel/datekit", { cookie: SIGNED_IN }),
      answer(branchPage),
    ],
    ["a page not found", get("/nowhere"), answer(branchPage, 404)],
    [
      "a raw file at a commit",
      get("/raw"),
      answer({ "cache-control": "public, max-age=31536000, immutable" }),
    ],
    ["an answer with no age", get("/x"), answer({ "cache-control": "public" })],
    [
      "the install script, which forbids serving it stale",
      get("/install.sh"),
      answer({ "cache-control": "public, max-age=300, must-revalidate" }),
    ],
  ] as const)(
    "gives the edge no longer window for %s",
    (_, request, response) => {
      expect(
        forTheEdge(request, response).headers.get(
          "cloudflare-cdn-cache-control"
        )
      ).toBeNull();
    }
  );

  it.effect("comes back with its status, its other headers and its body", () =>
    Effect.gen(function* () {
      const response = forTheEdge(
        get("/nowhere"),
        answer({ ...branchPage, "content-type": "text/html" }, 404)
      );

      expect({
        body: yield* Effect.promise(() => response.text()),
        contentType: response.headers.get("content-type"),
        status: response.status,
      }).toStrictEqual({
        body: "the page",
        contentType: "text/html",
        status: 404,
      });
    })
  );
});

describe("the Worker's entry", () => {
  it.effect(
    "hands the request and the Worker's env and context to Start, and its answer to the edge's rule",
    () =>
      Effect.gen(function* () {
        const handed: unknown[] = [];

        const entry = edgeEntry({
          fetch: (request: Request, env: string, context: string) => {
            handed.push(request.url, env, context);

            return Promise.resolve(answer(branchPage));
          },
        });

        const response = yield* Effect.promise(() =>
          entry.fetch(get("/", { cookie: SIGNED_IN }), "env", "context")
        );

        expect(handed).toStrictEqual([`${WEB_URL}/`, "env", "context"]);
        expect(kept(response).cacheControl).toBe(KEPT_NOWHERE);
      })
  );

  it("is Start's server entry behind the address redirects, wrapped by edgeEntry, and nothing else", () => {
    const sources: Readonly<Record<string, string>> = import.meta.glob(
      "../src/server.ts",
      { eager: true, import: "default", query: "?raw" }
    );

    const code = (sources["../src/server.ts"] ?? "")
      .replaceAll(/\/\*\*[\s\S]*?\*\//gu, "")
      .trim();

    expect(code.split(/\n+/u)).toStrictEqual([
      'import handler from "@tanstack/react-start/server-entry";',
      'import { addressedEntry } from "./server/addresses.ts";',
      'import { edgeEntry } from "./server/edge-cache.ts";',
      "export default edgeEntry(addressedEntry(handler));",
    ]);
  });
});

const listingDatekit = () =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("listProjects", () =>
          Effect.succeed({
            projects: [
              {
                openAsks: 0,
                posture: "open" as const,
                project: ProjectName.make("oscabriel/datekit"),
              },
            ],
          })
        ),
        Contracts.toLayerHandler("listAsks", () => Effect.succeed({ asks: [] }))
      ),
      asTester,
    ])
  );

const platformEnv: Env = {
  PLATFORM: untouchable<Fetcher>("PLATFORM", {
    fetch: () =>
      Promise.resolve(
        answer({ "cache-control": "public, max-age=31536000, immutable" })
      ),
  }),
  PUBLIC_PLATFORM_URL: PLATFORM_URL,
};

// Each answers a public `Cache-Control` of its own; the entry is what keeps a reader's answer from the edge.
const CREDENTIAL_ROUTES: readonly (readonly [
  string,
  (request: Request) => Promise<Response>,
])[] = [
  [
    "/llms.txt",
    (request) => frontLlmsHandler(listingDatekit, PLATFORM_URL)({ request }),
  ],
  [
    "/oscabriel/datekit/llms.txt",
    (request) =>
      projectLlmsHandler(
        listingDatekit,
        PLATFORM_URL
      )({ params: { project: "datekit" }, request }),
  ],
  [
    "/",
    (request) =>
      Promise.resolve(
        landingHandler(
          listingDatekit,
          PLATFORM_URL
        )({
          next: () => answer(branchPage),
          request,
        })
      ),
  ],
  [
    "/asks",
    (request) =>
      Promise.resolve(
        frontPageHandler(
          listingDatekit,
          PLATFORM_URL
        )({
          next: () => answer(branchPage),
          request,
        })
      ),
  ],
  [
    "/oscabriel/datekit/raw/main/README.md",
    (request) => forwarded(backend, platformEnv).GET({ request }),
  ],
  [
    "/rpc",
    (request) =>
      rpcHandler(
        backend,
        platformEnv
      )({ request: new Request(request, { body: "{}", method: "POST" }) }),
  ],
];

const signedInAt = (path: string) =>
  get(path, { accept: "text/markdown", cookie: SIGNED_IN });

describe("a route that hands the reader's cookie on", () => {
  it.effect.each(CREDENTIAL_ROUTES)(
    "%s is kept nowhere when a session cookie comes with it",
    ([path, handle]) =>
      Effect.gen(function* () {
        const own = yield* Effect.promise(() => handle(signedInAt(path)));

        // The route alone would let a shared cache keep it.
        expect(own.headers.get("cache-control")).toMatch(/^public\b/u);

        const served = yield* Effect.promise(() =>
          edgeEntry({ fetch: handle }).fetch(signedInAt(path))
        );

        expect(kept(served).cacheControl).toBe(KEPT_NOWHERE);
      })
  );

  it.effect.each(CREDENTIAL_ROUTES)(
    "%s, with no cookie, is kept as it says and varied by Cookie",
    ([path, handle]) =>
      Effect.gen(function* () {
        const served = yield* Effect.promise(() =>
          edgeEntry({ fetch: handle }).fetch(
            get(path, { accept: "text/markdown" })
          )
        );

        expect(kept(served).cacheControl).toMatch(/^public\b/u);
        expect(kept(served).vary).toMatch(/\bCookie$/u);
      })
  );
});

const landing = (request: Request) =>
  Promise.resolve(
    landingHandler(
      listingDatekit,
      PLATFORM_URL
    )({
      next: () => answer(branchPage),
      request,
    })
  );

describe("the landing", () => {
  it.effect(
    "sends a reader who carries a session to their inbox, and the edge keeps that nowhere",
    () =>
      Effect.gen(function* () {
        const served = yield* Effect.promise(() =>
          edgeEntry({ fetch: landing }).fetch(
            get("/", { accept: "text/html", cookie: SIGNED_IN })
          )
        );

        expect({
          location: served.headers.get("location"),
          status: served.status,
          ...kept(served),
        }).toStrictEqual({
          cacheControl: KEPT_NOWHERE,
          location: "/inbox",
          status: 302,
          vary: null,
        });
      })
  );

  it.effect(
    "is the same page for every reader without a session, which the edge may keep",
    () =>
      Effect.gen(function* () {
        const served = yield* Effect.promise(() =>
          edgeEntry({ fetch: landing }).fetch(get("/", { accept: "text/html" }))
        );

        expect(served.status).toBe(200);
        expect(kept(served).cacheControl).toMatch(/^public\b/u);
        expect(kept(served).vary).toMatch(/\bCookie$/u);
      })
  );

  it.effect("lets a cookie that is not a session through to the page", () =>
    Effect.gen(function* () {
      const own = yield* Effect.promise(() =>
        landing(get("/", { accept: "text/html", cookie: "theme=dark" }))
      );

      expect(own.status).toBe(200);
    })
  );
});

const routeSources: Readonly<Record<string, string>> = import.meta.glob(
  "../src/routes/**/*.{ts,tsx}",
  { eager: true, import: "default", query: "?raw" }
);

const allSources: Readonly<Record<string, string>> = import.meta.glob(
  "../src/**/*.{ts,tsx}",
  { eager: true, import: "default", query: "?raw" }
);

const readsTheRequest = /from "@tanstack\/react-start\/server"/u;

describe("a page", () => {
  it("reads the reader's request only where it is kept nowhere", () => {
    const reading = Object.entries(allSources).flatMap(([path, source]) =>
      readsTheRequest.test(source) ? [path] : []
    );

    expect(reading.toSorted()).toStrictEqual([
      "../src/routes/$owner/$project/decisions/$decision.tsx",
      "../src/routes/inbox.tsx",
    ]);

    for (const path of reading) {
      const source = routeSources[path] ?? "";

      expect(source, `${path} is kept nowhere`).toContain("personalPage");
      expect(source, `${path} is never kept at main`).not.toContain(
        "branchPage"
      );
    }
  });

  it("that the edge may keep reads as nobody, so its markup is the same for every reader", () => {
    const keepable = Object.entries(routeSources).filter(([, source]) =>
      source.includes("branchPage")
    );

    expect(keepable.length).toBeGreaterThan(10);

    for (const [path, source] of keepable) {
      expect(source, `${path} reaches no request`).not.toMatch(readsTheRequest);
      expect(source, `${path} reads no cookie`).not.toMatch(
        /credentialFrom|SESSION_COOKIE|HANDLE_COOKIE/u
      );
    }
  });
});
