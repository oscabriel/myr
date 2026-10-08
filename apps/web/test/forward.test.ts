/**
 * The paths the platform serves and the web host only passes on:
 * the projects' skills under `/.well-known/agent-skills/`, the CLI's
 * `/install.sh` and its `/releases/`. Each route hands GET and HEAD to the
 * backend; the production backend forwards over `PLATFORM` at the
 * platform's URL with the path, query, method and headers as they came,
 * and the platform's answer comes back as it is, a redirect's path-absolute
 * `Location` included, so the next request stays on the web host.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect } from "effect";

import { forwarded } from "../src/features/agents/forward.ts";
import { Route as skills } from "../src/routes/[.]well-known/agent-skills/$.ts";
import { Route as installScript } from "../src/routes/install[.]sh.ts";
import { Route as releases } from "../src/routes/releases/$.ts";
import { backend } from "../src/server/backend.ts";

const PLATFORM_URL = "https://platform-test.example.workers.dev";

const WEB_URL = "https://web-test.example.workers.dev";

/** A PLATFORM binding that keeps each request it is handed and answers `answer`. */
const platform = (answer: (request: Request) => Response) => {
  const handed: Request[] = [];

  const env: Env = {
    PLATFORM: untouchable<Fetcher>("PLATFORM", {
      fetch: (input, init) => {
        const request = new Request(input, init);

        handed.push(request);

        return Promise.resolve(answer(request));
      },
    }),
    PUBLIC_PLATFORM_URL: PLATFORM_URL,
  };

  return { env, handed };
};

/** The production routes' handlers, over a fake PLATFORM. */
const served = (answer: (request: Request) => Response) => {
  const binding = platform(answer);

  return { ...binding, handlers: forwarded(backend, binding.env) };
};

const PATHS = [
  "/.well-known/agent-skills/index.json",
  "/.well-known/agent-skills/datekit-contribute/SKILL.md",
  "/install.sh",
  "/releases/manifest.json",
  `/releases/0.1.0/${Brand.slug}-linux-x64`,
  "/releases/0.1.0/SHA256SUMS",
] as const;

describe("a path the platform serves, reached on the web host", () => {
  it.effect.each(PATHS)(
    "%s goes to PLATFORM at the platform's URL, by GET and by HEAD",
    (path) =>
      Effect.gen(function* () {
        const { handed, handlers } = served(() => new Response("served"));

        for (const method of ["GET", "HEAD"] as const) {
          yield* Effect.promise(() =>
            handlers[method]({
              request: new Request(`${WEB_URL}${path}?v=1`, {
                headers: { "if-none-match": '"abc"' },
                method,
              }),
            })
          );
        }

        expect(
          handed.map((request) => ({
            ifNoneMatch: request.headers.get("if-none-match"),
            method: request.method,
            url: request.url,
          }))
        ).toStrictEqual(
          ["GET", "HEAD"].map((method) => ({
            ifNoneMatch: '"abc"',
            method,
            url: `${PLATFORM_URL}${path}?v=1`,
          }))
        );
      })
  );

  it.effect(
    "comes back as the platform answered, a redirect's Location kept",
    () =>
      Effect.gen(function* () {
        const { handlers } = served(
          () =>
            new Response(null, {
              headers: {
                "cache-control": "public, max-age=300",
                location: `/releases/0.1.0/${Brand.slug}-linux-x64`,
              },
              status: 302,
            })
        );

        const response = yield* Effect.promise(() =>
          handlers.GET({
            request: new Request(
              `${WEB_URL}/releases/latest/${Brand.slug}-linux-x64`
            ),
          })
        );

        expect({
          cacheControl: response.headers.get("cache-control"),
          location: response.headers.get("location"),
          status: response.status,
        }).toStrictEqual({
          cacheControl: "public, max-age=300",
          location: `/releases/0.1.0/${Brand.slug}-linux-x64`,
          status: 302,
        });
      })
  );
});

/** What a route says of its server handlers. */
interface ServerRoute {
  readonly options: { readonly server?: { readonly handlers?: object } };
}

// Imported with the file, not in the test: loading a route module pulls in
// the router, which can take longer than a test's timeout under a full
// verify's load.
const forwardingRoutes: readonly (readonly [string, ServerRoute])[] = [
  ["the skills", skills],
  ["the install script", installScript],
  ["the releases", releases],
];

describe("the forwarding routes", () => {
  it.each(forwardingRoutes)(
    "%s answer GET and HEAD, and nothing else",
    (_name, route) => {
      expect(
        Object.keys(route.options.server?.handlers ?? {}).toSorted()
      ).toStrictEqual(["GET", "HEAD"]);
    }
  );
});
