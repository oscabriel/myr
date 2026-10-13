import { describe, expect, it } from "@effect/vitest";
import { Handle } from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { hereOf, SessionView } from "../src/features/auth/session-slot.tsx";
import { devSignIn } from "../src/routes/auth/-dev.ts";
import { backend } from "../src/server/backend.ts";
import { serverClientOver } from "../src/server/client.ts";
import {
  callbackHandler,
  challengeOf,
  clearedCookie,
  clientMetadataHandler,
  credentialFrom,
  HANDLE_COOKIE,
  pkce,
  SESSION_COOKIE,
  sessionCookie,
  signInHandler,
  signOutHandler,
  whoamiHandler,
  withCredential,
} from "../src/server/session.ts";

const PLATFORM_URL = "https://platform-test.example.workers.dev";

const WEB_URL = "https://web-test.example.workers.dev";

const LIST_ASKS =
  '[{"_tag":"Request","id":"0","tag":"listAsks","payload":{"project":"datekit"},"headers":[]}]';

/** What the platform's `/token` answers a good code with (1.2.1's shape). */
const TOKEN_ANSWER = {
  access_token: "alice:grant1:tok-from-platform",
  expires_in: 3600,
  refresh_token: "alice:grant1:refresh-secret",
  scope: "",
  token_type: "bearer",
};

const seenOf = (request: Request) =>
  Effect.map(
    Effect.promise(() => request.text()),
    (body) => ({
      authorization: request.headers.get("authorization"),
      body,
      cookie: request.headers.get("cookie"),
      method: request.method,
      url: request.url,
    })
  );

const recorder = (answer: (request: Request) => Response) => {
  const handed: Request[] = [];

  const fetch = (request: Request) => {
    handed.push(request);

    return Promise.resolve(answer(request));
  };

  return { fetch, seen: Effect.suspend(() => Effect.forEach(handed, seenOf)) };
};

const envWith = (fetch: (request: Request) => Promise<Response>): Env => ({
  PLATFORM: untouchable<Fetcher>("PLATFORM", {
    fetch: (input, init) => fetch(new Request(input, init)),
  }),
  PUBLIC_PLATFORM_URL: PLATFORM_URL,
});

const unreachable: Env = {
  PLATFORM: untouchable<Fetcher>("PLATFORM"),
  PUBLIC_PLATFORM_URL: PLATFORM_URL,
};

const listAsksPost = (headers: Readonly<Record<string, string>> = {}) =>
  new Request(`${WEB_URL}/rpc`, {
    body: LIST_ASKS,
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

const get = (path: string, headers: Readonly<Record<string, string>> = {}) =>
  new Request(`${WEB_URL}${path}`, { headers });

const cookiesOf = (response: Response) =>
  response.headers.getSetCookie().map((line) => {
    const [pair = "", ...attributes] = line
      .split(";")
      .map((part) => part.trim());

    const at = pair.indexOf("=");

    return {
      attributes: attributes.map((attribute) => attribute.toLowerCase()),
      name: pair.slice(0, at),
      pair,
      value: pair.slice(at + 1),
    };
  });

const expiriesOf = (response: Response) =>
  cookiesOf(response).map(({ attributes, name }) => [
    name,
    attributes.includes("max-age=0"),
  ]);

const maxAgeOf = (attributes: readonly string[]) =>
  Number(
    attributes.find((attribute) => attribute.startsWith("max-age="))?.slice(8)
  );

const LOCKED_DOWN = ["httponly", "secure", "samesite=lax", "path=/"] as const;

const lockedDown = (attributes: readonly string[] = []) =>
  LOCKED_DOWN.every((attribute) => attributes.includes(attribute));

const textOf = (response: Response) => Effect.promise(() => response.text());

const paramsOf = (url: URL, names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, url.searchParams.get(name)]));

const replyingWith = (exit: string) => {
  const parts: string[] = [];

  return new TransformStream<string, string>({
    flush: (controller) => {
      const id =
        /"id":(?<id>"[^"]*"|\d+)/u.exec(parts.join(""))?.groups?.id ?? "null";

      controller.enqueue(`[{"_tag":"Exit","requestId":${id},"exit":${exit}}]`);
    },
    transform: (chunk) => {
      parts.push(chunk);
    },
  });
};

const statusReply = (exit: string) => (request: Request) =>
  new Response(
    (request.clone().body ?? new Blob().stream())
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(replyingWith(exit))
      .pipeThrough(new TextEncoderStream()),
    { headers: { "content-type": "application/json" } }
  );

const STATUS_OF_INES =
  '{"_tag":"Success","value":{"answers":[],"claims":[],"handle":"ines-v"}}';

const UNAUTHENTICATED =
  '{"_tag":"Failure","cause":[{"_tag":"Fail","error":{"_tag":"Unauthenticated"}}]}';

describe("the session cookie", () => {
  it("is read from the cookie header, among the others", () => {
    expect(
      [
        `theme=dark; ${SESSION_COOKIE}=tok123; other=1`,
        "theme=dark",
        `${SESSION_COOKIE}=`,
        `${SESSION_COOKIE}=two%20words`,
      ].map((cookie) => credentialFrom(get("/rpc", { cookie })))
    ).toStrictEqual([
      Option.some("tok123"),
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
    expect(credentialFrom(get("/rpc"))).toStrictEqual(Option.none());
  });

  it("reads back the token a session cookie was set with", () => {
    const token = "alice:grant1:tok/with+odd=chars";
    const [pair = ""] = sessionCookie(token, 60).split(";");

    expect(credentialFrom(get("/rpc", { cookie: pair }))).toStrictEqual(
      Option.some(token)
    );
  });

  it("is HttpOnly, Secure, SameSite=Lax, on every path, for as long as it is given", () => {
    const [cookie] = cookiesOf(
      new Response(null, { headers: { "set-cookie": sessionCookie("t", 90) } })
    );

    expect(cookie?.name).toBe(SESSION_COOKIE);
    expect(cookie?.attributes).toStrictEqual(
      expect.arrayContaining([...LOCKED_DOWN, "max-age=90"])
    );
  });

  it("is cleared by a cookie of the same name that expires now", () => {
    const [cookie] = cookiesOf(
      new Response(null, { headers: { "set-cookie": clearedCookie() } })
    );

    expect(cookie?.name).toBe(SESSION_COOKIE);
    expect(cookie?.value).toBe("");
    expect(cookie?.attributes).toStrictEqual(
      expect.arrayContaining([...LOCKED_DOWN, "max-age=0"])
    );
  });

  it("becomes the only credential a forwarded request carries", () => {
    const forwarded = withCredential(
      get("/rpc", {
        authorization: "Bearer chosen-by-the-browser",
        cookie: `${SESSION_COOKIE}=tok123`,
      }),
      Option.some("tok123")
    );

    const anonymous = withCredential(
      get("/rpc", { authorization: "Bearer chosen-by-the-browser" }),
      Option.none()
    );

    expect(forwarded.headers.get("authorization")).toBe("Bearer tok123");
    expect(forwarded.headers.get("cookie")).toBeNull();
    expect(anonymous.headers.get("authorization")).toBeNull();
  });
});

describe("PKCE", () => {
  it.effect("challenges with S256 (RFC 7636 appendix B)", () =>
    Effect.gen(function* () {
      expect(
        yield* challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
      ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    })
  );

  it.effect("draws a fresh verifier and state each time, from WebCrypto", () =>
    Effect.gen(function* () {
      const first = yield* pkce;
      const second = yield* pkce;

      expect(first.verifier).toMatch(/^[\w-]{43,128}$/u);
      expect(first.state).toMatch(/^[\w-]{22,}$/u);
      expect(first.challenge).toBe(yield* challengeOf(first.verifier));
      expect([second.verifier, second.state]).not.toStrictEqual([
        first.verifier,
        first.state,
      ]);
    })
  );
});

describe("the production backend", () => {
  it.effect(
    "forwards a /rpc call with the session cookie's token as a bearer, and no cookie",
    () =>
      Effect.gen(function* () {
        const platform = recorder(() => new Response("from the platform"));

        const response = yield* Effect.promise(() =>
          backend(
            listAsksPost({ cookie: `${SESSION_COOKIE}=tok123; other=1` }),
            envWith(platform.fetch)
          )
        );

        expect(yield* platform.seen).toStrictEqual([
          {
            authorization: "Bearer tok123",
            body: LIST_ASKS,
            cookie: null,
            method: "POST",
            url: `${PLATFORM_URL}/rpc`,
          },
        ]);
        expect(yield* textOf(response)).toBe("from the platform");
      })
  );

  it.effect(
    "drops an authorization the browser set, and forwards a call with no cookie with no credential",
    () =>
      Effect.gen(function* () {
        const platform = recorder(() => new Response("public"));

        yield* Effect.promise(() =>
          backend(
            listAsksPost({ authorization: "Bearer chosen-by-the-browser" }),
            envWith(platform.fetch)
          )
        );

        expect(yield* platform.seen).toStrictEqual([
          {
            authorization: null,
            body: LIST_ASKS,
            cookie: null,
            method: "POST",
            url: `${PLATFORM_URL}/rpc`,
          },
        ]);
      })
  );

  it.effect(
    "asks again with no credential when the platform no longer knows the token, and expires the cookie",
    () =>
      Effect.gen(function* () {
        const platform = recorder((request) =>
          request.headers.has("authorization")
            ? new Response(null, {
                headers: { "www-authenticate": 'Bearer error="invalid_token"' },
                status: 401,
              })
            : new Response("as anyone")
        );

        const response = yield* Effect.promise(() =>
          backend(
            listAsksPost({ cookie: `${SESSION_COOKIE}=stale` }),
            envWith(platform.fetch)
          )
        );

        const seen = yield* platform.seen;

        expect(
          seen.map(({ authorization, body }) => [authorization, body])
        ).toStrictEqual([
          ["Bearer stale", LIST_ASKS],
          [null, LIST_ASKS],
        ]);
        expect([response.status, yield* textOf(response)]).toStrictEqual([
          200,
          "as anyone",
        ]);
        expect(expiriesOf(response)).toStrictEqual([
          [SESSION_COOKIE, true],
          [HANDLE_COOKIE, true],
        ]);
      })
  );

  it.effect("carries the session on a GET too, at the platform's URL", () =>
    Effect.gen(function* () {
      const platform = recorder(() => new Response("ok"));

      yield* Effect.promise(() =>
        backend(
          get("/releases/x?y=1", { cookie: `${SESSION_COOKIE}=tok123` }),
          envWith(platform.fetch)
        )
      );

      expect(
        (yield* platform.seen).map(({ authorization, method, url }) => [
          method,
          url,
          authorization,
        ])
      ).toStrictEqual([
        ["GET", `${PLATFORM_URL}/releases/x?y=1`, "Bearer tok123"],
      ]);
    })
  );
});

const signIn = (path: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      signInHandler(unreachable)({ request: get(path) })
    );

    const location = new URL(response.headers.get("location") ?? "");
    const [state] = cookiesOf(response);

    return { location, response, state };
  });

const clientOver = (env: Env) => (request: Request) =>
  serverClientOver(backend)(env, request);

const unreachableCallback = callbackHandler(
  unreachable,
  clientOver(unreachable)
);

const signInAndBack = (
  path: string,
  code: string,
  answer: () => Response = () => Response.json(TOKEN_ANSWER),
  status: (request: Request) => Response = statusReply(STATUS_OF_INES)
) =>
  Effect.gen(function* () {
    const { location, state } = yield* signIn(path);

    const platform = recorder((request) =>
      new URL(request.url).pathname.startsWith("/rpc")
        ? status(request)
        : answer()
    );

    const env = envWith(platform.fetch);

    const response = yield* Effect.promise(() =>
      callbackHandler(
        env,
        clientOver(env)
      )({
        request: get(
          `/auth/callback?code=${code}&state=${location.searchParams.get("state") ?? ""}`,
          { cookie: state?.pair ?? "" }
        ),
      })
    );

    return { location, response, seen: yield* platform.seen, state };
  });

const backTo = (path: string) =>
  Effect.map(
    signInAndBack(`/auth/signin?return=${encodeURIComponent(path)}`, "c0de"),
    ({ response }) => response.headers.get("location")
  );

describe("sign-in", () => {
  it.effect(
    "sends the browser to the platform's /authorize as the web's public client, with S256",
    () =>
      Effect.gen(function* () {
        const { location, response } = yield* signIn(
          "/auth/signin?return=/inbox"
        );

        expect(response.status).toBe(302);
        expect(`${location.origin}${location.pathname}`).toBe(
          `${PLATFORM_URL}/authorize`
        );
        expect(
          paramsOf(location, [
            "client_id",
            "code_challenge_method",
            "redirect_uri",
            "response_type",
          ])
        ).toStrictEqual({
          client_id: `${WEB_URL}/auth/client`,
          code_challenge_method: "S256",
          redirect_uri: `${WEB_URL}/auth/callback`,
          response_type: "code",
        });
        expect(location.searchParams.get("code_challenge")).toMatch(
          /^[\w-]{43}$/u
        );
      })
  );

  it.effect(
    "keeps the state and verifier in a short-lived HttpOnly cookie, never in the URL",
    () =>
      Effect.gen(function* () {
        const { location, state } = yield* signIn("/auth/signin");

        expect(location.searchParams.get("state")).toMatch(/^[\w-]{22,}$/u);
        expect(state?.name).not.toBe(SESSION_COOKIE);
        expect(lockedDown(state?.attributes)).toBeTruthy();
        expect(maxAgeOf(state?.attributes ?? [])).toBeLessThanOrEqual(600);
        expect(location.searchParams.has("code_verifier")).toBeFalsy();
      })
  );
});

describe("the callback", () => {
  it.effect(
    "trades the code at the platform's /token over PLATFORM, with the verifier sign-in kept",
    () =>
      Effect.gen(function* () {
        const { location, seen } = yield* signInAndBack(
          "/auth/signin?return=/inbox",
          "c0de"
        );

        const [exchange, ...more] = seen;
        const form = new URLSearchParams(exchange?.body);

        // Then once, with the new token, `status`: the handle it names is
        // kept beside the session, so no page asks the platform again.
        expect(
          more.map(({ authorization, body, cookie, url }) => [
            new URL(url).pathname.replace(/\/$/u, ""),
            authorization,
            cookie,
            body.includes('"tag":"status"'),
          ])
        ).toStrictEqual([
          ["/rpc", `Bearer ${TOKEN_ANSWER.access_token}`, null, true],
        ]);
        expect([
          exchange?.method,
          exchange?.url,
          exchange?.cookie,
        ]).toStrictEqual(["POST", `${PLATFORM_URL}/token`, null]);
        expect(
          Object.fromEntries(
            ["client_id", "code", "grant_type", "redirect_uri"].map((name) => [
              name,
              form.get(name),
            ])
          )
        ).toStrictEqual({
          client_id: `${WEB_URL}/auth/client`,
          code: "c0de",
          grant_type: "authorization_code",
          redirect_uri: `${WEB_URL}/auth/callback`,
        });
        expect(yield* challengeOf(form.get("code_verifier") ?? "")).toBe(
          location.searchParams.get("code_challenge")
        );
      })
  );

  it.effect(
    "sets the token only as the HttpOnly session cookie, for no longer than the token lives, and goes back",
    () =>
      Effect.gen(function* () {
        const { response, state } = yield* signInAndBack(
          "/auth/signin?return=/inbox",
          "c0de"
        );

        const cookies = cookiesOf(response);
        const session = cookies.find(({ name }) => name === SESSION_COOKIE);
        const maxAge = maxAgeOf(session?.attributes ?? []);

        expect([
          response.status,
          response.headers.get("location"),
        ]).toStrictEqual([302, "/inbox"]);
        expect(
          credentialFrom(get("/rpc", { cookie: session?.pair ?? "" }))
        ).toStrictEqual(Option.some(TOKEN_ANSWER.access_token));
        expect({
          lockedDown: lockedDown(session?.attributes),
          lives: maxAge > 0 && maxAge <= TOKEN_ANSWER.expires_in,
        }).toStrictEqual({ lives: true, lockedDown: true });
        expect(expiriesOf(response)).toContainEqual([state?.name, true]);
      })
  );

  it.effect(
    "answers with no token or refresh token in its body or its URL",
    () =>
      Effect.gen(function* () {
        const { response } = yield* signInAndBack("/auth/signin", "c0de");

        const shown = `${yield* textOf(response)}\n${response.headers.get("location") ?? ""}`;

        expect(shown).not.toContain("tok-from-platform");
        expect(shown).not.toContain("refresh-secret");
        expect(response.headers.getSetCookie().join("\n")).not.toContain(
          "refresh-secret"
        );
      })
  );

  it.effect(
    "answers 400 and sets no session when the state is not the one sign-in sent",
    () =>
      Effect.gen(function* () {
        const { state } = yield* signIn("/auth/signin");

        const response = yield* Effect.promise(() =>
          unreachableCallback({
            request: get("/auth/callback?code=c0de&state=forged", {
              cookie: state?.pair ?? "",
            }),
          })
        );

        expect(response.status).toBe(400);
        expect(
          cookiesOf(response).filter(({ name }) => name === SESSION_COOKIE)
        ).toStrictEqual([]);
      })
  );

  it.effect("answers 400 when the browser holds no sign-in in progress", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        unreachableCallback({
          request: get("/auth/callback?code=c0de&state=anything"),
        })
      );

      expect(response.status).toBe(400);
      expect(
        cookiesOf(response).filter(({ name }) => name === SESSION_COOKIE)
      ).toStrictEqual([]);
    })
  );

  it.effect(
    "answers 400 and sets no session when the platform refuses the code",
    () =>
      Effect.gen(function* () {
        const { response } = yield* signInAndBack("/auth/signin", "used", () =>
          Response.json({ error: "invalid_grant" }, { status: 400 })
        );

        expect(response.status).toBe(400);
        expect(
          cookiesOf(response).filter(({ name }) => name === SESSION_COOKIE)
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "answers 400 and sets no session when the token is not one the session cookie can carry back",
    () =>
      Effect.gen(function* () {
        const { response } = yield* signInAndBack("/auth/signin", "c0de", () =>
          Response.json({ ...TOKEN_ANSWER, access_token: "two words" })
        );

        expect(response.status).toBe(400);
        expect(
          cookiesOf(response).filter(({ name }) => name === SESSION_COOKIE)
        ).toStrictEqual([]);
      })
  );

  it.effect("goes back only to a path on the web itself", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.forEach(
          [
            "/oscabriel/datekit/asks/a1?tab=check",
            "https://elsewhere.example/",
            "//elsewhere.example/",
            "/\\elsewhere.example/",
            "/auth/signout",
          ],
          backTo
        )
      ).toStrictEqual([
        "/oscabriel/datekit/asks/a1?tab=check",
        "/",
        "/",
        "/",
        "/",
      ]);
    })
  );
});

describe("sign-out", () => {
  it("goes home and expires the session and handle cookies, by POST or by a plain link", () => {
    const answers = ["POST", "GET"].map((method) => {
      const response = signOutHandler({
        request: new Request(`${WEB_URL}/auth/signout`, {
          headers: { cookie: `${SESSION_COOKIE}=tok123` },
          method,
        }),
      });

      return [
        response.status,
        response.headers.get("location"),
        expiriesOf(response),
      ];
    });

    expect(answers).toStrictEqual([
      [
        302,
        "/",
        [
          [SESSION_COOKIE, true],
          [HANDLE_COOKIE, true],
        ],
      ],
      [
        302,
        "/",
        [
          [SESSION_COOKIE, true],
          [HANDLE_COOKIE, true],
        ],
      ],
    ]);
  });
});

const whoami = (env: Env, headers: Readonly<Record<string, string>> = {}) =>
  Effect.promise(() =>
    whoamiHandler((request) => serverClientOver(backend)(env, request))({
      request: get("/auth/whoami", headers),
    })
  );

describe("whoami", () => {
  it.effect(
    "answers {} without asking the platform when nobody is signed in",
    () =>
      Effect.gen(function* () {
        const response = yield* whoami(unreachable);

        expect(response.status).toBe(200);
        expect(yield* textOf(response)).toBe("{}");
      })
  );

  it.effect(
    "answers the handle the platform's status names for the session",
    () =>
      Effect.gen(function* () {
        const platform = recorder(statusReply(STATUS_OF_INES));

        const response = yield* whoami(envWith(platform.fetch), {
          cookie: `${SESSION_COOKIE}=tok123`,
        });

        expect(
          (yield* platform.seen).map(
            ({ authorization, body, cookie, url }) => ({
              authorization,
              cookie,
              path: new URL(url).pathname.replace(/\/$/u, ""),
              status: body.includes('"tag":"status"'),
            })
          )
        ).toStrictEqual([
          {
            authorization: "Bearer tok123",
            cookie: null,
            path: "/rpc",
            status: true,
          },
        ]);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(yield* textOf(response)).toBe('{"handle":"ines-v"}');

        // A session from before the handle was kept: asked once, then kept.
        const kept = cookiesOf(response).filter(
          ({ name }) => name === HANDLE_COOKIE
        );

        expect(
          kept.map(({ attributes }) => lockedDown(attributes))
        ).toStrictEqual([true]);

        const again = yield* whoami(unreachable, {
          cookie: [
            `${SESSION_COOKIE}=tok123`,
            ...kept.map(({ pair }) => pair),
          ].join("; "),
        });

        expect(yield* textOf(again)).toBe('{"handle":"ines-v"}');
      })
  );

  it.effect(
    "answers {} and expires both cookies when the platform no longer knows the session",
    () =>
      Effect.gen(function* () {
        const platform = recorder((request) =>
          request.headers.has("authorization")
            ? new Response(null, { status: 401 })
            : statusReply(UNAUTHENTICATED)(request)
        );

        const response = yield* whoami(envWith(platform.fetch), {
          cookie: `${SESSION_COOKIE}=stale`,
        });

        expect(yield* textOf(response)).toBe("{}");
        expect(expiriesOf(response)).toStrictEqual([
          [SESSION_COOKIE, true],
          [HANDLE_COOKIE, true],
        ]);
      })
  );
});

const sentBack = (response: Response) =>
  cookiesOf(response)
    .filter(({ attributes }) => !attributes.includes("max-age=0"))
    .map(({ pair }) => pair)
    .join("; ");

describe("the handle kept beside the session", () => {
  it.effect(
    "after a sign-in, answers whoami with no call to the platform",
    () =>
      Effect.gen(function* () {
        const { response } = yield* signInAndBack("/auth/signin", "c0de");
        const who = yield* whoami(unreachable, { cookie: sentBack(response) });

        expect(yield* textOf(who)).toBe('{"handle":"ines-v"}');
        expect(who.headers.getSetCookie()).toStrictEqual([]);
      })
  );

  it.effect(
    "is a __Host- cookie the page's JavaScript never reads, living as long as the session",
    () =>
      Effect.gen(function* () {
        const { response } = yield* signInAndBack("/auth/signin", "c0de");
        const cookies = cookiesOf(response);
        const session = cookies.find(({ name }) => name === SESSION_COOKIE);
        const handle = cookies.find(({ name }) => name === HANDLE_COOKIE);

        expect({
          host: HANDLE_COOKIE.startsWith("__Host-"),
          lives: maxAgeOf(handle?.attributes ?? []),
          lockedDown: lockedDown(handle?.attributes),
          token: handle?.value.includes("tok-from-platform"),
        }).toStrictEqual({
          host: true,
          lives: maxAgeOf(session?.attributes ?? []),
          lockedDown: true,
          token: false,
        });
      })
  );

  it.effect(
    "is not kept when the platform names no one at sign-in, and the session still starts",
    () =>
      Effect.gen(function* () {
        const { response } = yield* signInAndBack(
          "/auth/signin",
          "c0de",
          () => Response.json(TOKEN_ANSWER),
          () => new Response("down", { status: 503 })
        );

        expect(
          cookiesOf(response)
            .map(({ name }) => name)
            .filter((name) => name !== "__Host-sign-in")
        ).toStrictEqual([SESSION_COOKIE]);
      })
  );

  it.effect("is not believed for another session: the platform is asked", () =>
    Effect.gen(function* () {
      const { response } = yield* signInAndBack("/auth/signin", "c0de");

      const handle = cookiesOf(response).find(
        ({ name }) => name === HANDLE_COOKIE
      );

      const platform = recorder(statusReply(STATUS_OF_INES));

      const who = yield* whoami(envWith(platform.fetch), {
        cookie: `${SESSION_COOKIE}=another-token; ${handle?.pair ?? ""}`,
      });

      expect(yield* textOf(who)).toBe('{"handle":"ines-v"}');
      expect(
        (yield* platform.seen).map(({ authorization }) => authorization)
      ).toStrictEqual(["Bearer another-token"]);
    })
  );

  it.effect("is expired, unread, once no session is left", () =>
    Effect.gen(function* () {
      const { response } = yield* signInAndBack("/auth/signin", "c0de");

      const handle = cookiesOf(response).find(
        ({ name }) => name === HANDLE_COOKIE
      );

      const who = yield* whoami(unreachable, { cookie: handle?.pair ?? "" });

      expect(yield* textOf(who)).toBe("{}");
      expect(expiriesOf(who)).toStrictEqual([[HANDLE_COOKIE, true]]);
    })
  );
});

const decodeDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
);

describe("the web's OAuth client", () => {
  it.effect(
    "is a public Client ID Metadata Document at its own URL, redirecting only to the callback",
    () =>
      Effect.gen(function* () {
        const response = clientMetadataHandler({
          request: get("/auth/client"),
        });

        const document = yield* decodeDocument(yield* textOf(response));

        expect(response.headers.get("content-type")).toContain(
          "application/json"
        );
        expect(document).toStrictEqual(
          expect.objectContaining({
            client_id: `${WEB_URL}/auth/client`,
            grant_types: ["authorization_code"],
            redirect_uris: [`${WEB_URL}/auth/callback`],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          })
        );
        expect(document).toHaveProperty("client_name", expect.any(String));
        expect(document).not.toHaveProperty("client_secret");
      })
  );
});

describe("the dev sign-in", () => {
  it("sets the session to the dev backend's token for a handle", () => {
    const response = devSignIn({
      request: get("/auth/dev?handle=ines-v&return=/inbox"),
    });

    const [session] = cookiesOf(response);

    expect([response.status, response.headers.get("location")]).toStrictEqual([
      302,
      "/inbox",
    ]);
    expect(lockedDown(session?.attributes)).toBeTruthy();
    expect(
      credentialFrom(get("/rpc", { cookie: session?.pair ?? "" }))
    ).toStrictEqual(Option.some("dev-ines-v"));
  });

  it("refuses a handle that is not one, and sets nothing", () => {
    const response = devSignIn({
      request: get("/auth/dev?handle=not%20a%20handle"),
    });

    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toStrictEqual([]);
  });
});

describe("the header's session slot", () => {
  const ines = Schema.decodeSync(Handle)("ines-v");

  it("names the person signed in, with a way to sign out", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionView, { handle: Option.some(ines), here: "/inbox" })
    );

    expect(markup).toContain(">ines-v<");
    expect(markup).toContain('href="/people/ines-v"');
    expect(markup).toMatch(
      /<form[^>]*action="\/auth\/signout"[^>]*method="post"/u
    );
    expect(markup).not.toContain("/auth/signin");
  });

  it("offers sign-in, coming back to the page it was on", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionView, { handle: Option.none(), here: "/inbox" })
    );

    expect(markup).toContain('href="/auth/signin?return=%2Finbox"');
    expect(markup).toContain(">Sign in<");
    expect(markup).not.toContain("/auth/signout");
  });

  it("comes back to the page without its #fragment, which the server never sees, so the link it renders matches in the browser", () => {
    const location = {
      hash: "L3",
      href: "/oscabriel/datekit/blob/main/src/add.ts?plain=1#L3",
      pathname: "/oscabriel/datekit/blob/main/src/add.ts",
      searchStr: "?plain=1",
    };

    expect(hereOf(location)).toBe(
      "/oscabriel/datekit/blob/main/src/add.ts?plain=1"
    );
  });
});
