import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { addressedEntry, canonicalAddress } from "../src/server/addresses.ts";
import { forTheEdge, KEPT_NOWHERE } from "../src/server/edge-cache.ts";

const WEB_URL = "https://web-test.example.workers.dev";

const request = (path: string, method = "GET") =>
  new Request(`${WEB_URL}${path}`, { method });

const movedTo = (path: string) =>
  Option.map(canonicalAddress(request(path)), (response) => [
    response.status,
    response.headers.get("location"),
  ]);

const pages = {
  fetch: (_request: Request) => new Response("the page", { status: 200 }),
};

describe("an old or miscased project address", () => {
  it("is a 301 from a key a project kept to its name, the rest and the query kept", () => {
    expect(movedTo("/datekit/tree/main?x=1")).toStrictEqual(
      Option.some([301, "/oscabriel/datekit/tree/main?x=1"])
    );
    expect(movedTo("/click")).toStrictEqual(
      Option.some([301, "/github.com/pallets/click"])
    );
  });

  it("is a 301 from a name in another case to its lowercase", () => {
    expect(movedTo("/OscaBriel/datekit")).toStrictEqual(
      Option.some([301, "/oscabriel/datekit"])
    );
    expect(movedTo("/GitHub.com/Pallets/click/tree/main")).toStrictEqual(
      Option.some([301, "/github.com/pallets/click/tree/main"])
    );
  });

  it("is a 301 from a name with a trailing .git to the name, the rest and the query kept", () => {
    expect(movedTo("/github.com/pallets/click.git")).toStrictEqual(
      Option.some([301, "/github.com/pallets/click"])
    );
    expect(movedTo("/oscabriel/datekit.git")).toStrictEqual(
      Option.some([301, "/oscabriel/datekit"])
    );
    expect(
      movedTo("/github.com/pallets/click.git/tree/main?x=1")
    ).toStrictEqual(
      Option.some([301, "/github.com/pallets/click/tree/main?x=1"])
    );
    expect(movedTo("/GitHub.com/Pallets/Click.GIT")).toStrictEqual(
      Option.some([301, "/github.com/pallets/click"])
    );
  });

  it("answers only a read with the .git 301", () => {
    expect(
      canonicalAddress(request("/github.com/pallets/click.git", "POST"))
    ).toStrictEqual(Option.none());
    expect(
      Option.map(
        canonicalAddress(request("/oscabriel/datekit.git", "HEAD")),
        (response) => response.status
      )
    ).toStrictEqual(Option.some(301));
  });

  it("is kept by the edge, as a page that reads as nobody", () => {
    const answered = Option.getOrThrow(
      canonicalAddress(request("/datekit/tree/main?x=1"))
    );

    const edge = forTheEdge(request("/datekit/tree/main?x=1"), answered);

    expect(edge.status).toBe(301);
    expect(edge.headers.get("cache-control")).not.toBe(KEPT_NOWHERE);
    expect(edge.headers.get("cache-control")).toContain("public");
  });
});

describe("an address that needs no redirect", () => {
  it("goes on to the pages: a canonical name, a source path, and a word no project has", () => {
    expect(movedTo("/oscabriel/datekit/tree/main")).toStrictEqual(
      Option.none()
    );
    expect(movedTo("/github.com/pallets/click/tree/main")).toStrictEqual(
      Option.none()
    );
    expect(movedTo("/no-such")).toStrictEqual(Option.none());
  });

  it("goes on to the web's own pages and files", () => {
    expect(movedTo("/asks")).toStrictEqual(Option.none());
    expect(movedTo("/llms.txt")).toStrictEqual(Option.none());
    expect(movedTo("/")).toStrictEqual(Option.none());
  });

  it("is never a redirect for a request that is not a read", () => {
    expect(
      canonicalAddress(request("/datekit/tree/main", "POST"))
    ).toStrictEqual(Option.none());
  });

  it.effect("reaches the entry behind it untouched", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        Promise.resolve(
          addressedEntry(pages).fetch(request("/oscabriel/datekit"))
        )
      );

      expect(response.status).toBe(200);
    })
  );
});
