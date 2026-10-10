/**
 * An ask answers as Markdown, so a harness reads it with one plain fetch:
 * the ask's URL with `Accept: text/markdown`, or the same URL with `.md`.
 * The body is the banner naming the web's indexes, then the brief the
 * platform rendered (`showAsk`), untouched; an unknown ask is a 404 whose
 * body is the refusal, as git would print it.
 * A browser asking for HTML gets the page.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { AskId, ProjectName } from "@repo/protocol/ids";
import { UnknownAsk, UnknownProject } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import { Effect, Exit, Layer, Ref } from "effect";
import { RpcTest } from "effect/rpc";

import { indexBanner } from "../src/features/agents/llms.ts";
import {
  askMarkdownResponse,
  refusalsMarkdown,
  wantsMarkdown,
} from "../src/features/ask/markdown.ts";
import {
  askPageHandler,
  askPageHeaders,
} from "../src/routes/$project/asks/$ask.tsx";
import { askMarkdownHandler } from "../src/routes/$project/asks/{$ask}[.]md.ts";
import { ask, askId, brief, project } from "./ask-fixtures.ts";

const WEB = "https://web-test.example.workers.dev";

/** Where the web's indexes are for datekit's asks, as the routes find them. */
const index = { project, webUrl: WEB };

/** An ask's Markdown as served: the banner naming the indexes, then the brief unchanged. */
const served = `${indexBanner(index)}\n\n${brief}`;

const MARKDOWN = "text/markdown; charset=utf-8";

const BROWSER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/**
 * A platform that knows datekit and its one ask, counting `showAsk` calls,
 * as a route's client.
 */
const platformOf = (calls: Ref.Ref<number>) => () =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("showAsk", (payload) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (count) => count + 1);

            if (payload.project !== project) {
              return yield* new UnknownProject({ project: payload.project });
            }

            if (payload.ask !== askId) {
              return yield* new UnknownAsk({ ask: payload.ask });
            }

            return { ask, brief };
          })
        )
      ),
      asTester,
    ])
  );

/** A platform that cannot be reached: every call dies on the way. */
const unreachable = () =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([unanswered, asTester])
  );

const get = (path: string, accept?: string) =>
  new Request(`${WEB}${path}`, {
    headers: accept === undefined ? {} : { accept },
  });

const params = (askName: string, projectName: string = project) => ({
  ask: askName,
  project: projectName,
});

/** What a response says, read whole. */
const read = (response: Response) =>
  Effect.map(
    Effect.promise(() => response.text()),
    (body) => ({
      body,
      cacheControl: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
      status: response.status,
      vary: response.headers.get("vary"),
    })
  );

/** The page's own render, which a Markdown request must never reach. */
const PAGE = new Response("<!doctype html><title>the page</title>");

describe("an ask's URL with Accept: text/markdown", () => {
  it.effect(
    "answers with the brief showAsk gives, as Markdown that public caches may keep a minute",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const response = yield* Effect.promise(() =>
          Promise.resolve(
            askPageHandler(platformOf(calls))({
              next: () => PAGE,
              params: params(askId),
              request: get(`/datekit/asks/${askId}`, "text/markdown"),
            })
          )
        );

        expect(yield* read(response)).toStrictEqual({
          body: served,
          cacheControl: "public, max-age=60",
          contentType: MARKDOWN,
          status: 200,
          vary: "Accept",
        });
        expect(yield* Ref.get(calls)).toBe(1);
      })
  );

  it.effect(
    "falls through to the page when the reader asks for HTML, and reads no ask",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const answered = askPageHandler(platformOf(calls))({
          next: () => PAGE,
          params: params(askId),
          request: get(`/datekit/asks/${askId}`, BROWSER),
        });

        expect(answered).toBe(PAGE);
        expect(yield* Ref.get(calls)).toBe(0);
      })
  );
});

describe("an ask's .md URL", () => {
  it.effect(
    "answers with the same Markdown, whatever the request accepts",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const response = yield* Effect.promise(() =>
          askMarkdownHandler(platformOf(calls))({
            params: params(askId),
            request: get(`/datekit/asks/${askId}.md`, BROWSER),
          })
        );

        expect(yield* read(response)).toStrictEqual({
          body: served,
          cacheControl: "public, max-age=60",
          contentType: MARKDOWN,
          status: 200,
          vary: "Accept",
        });
      })
  );

  it.effect(
    "answers an unknown ask with 404 and the UnknownAsk refusal, as git prints it, then its next command",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);
        const refusal = new UnknownAsk({ ask: AskId.make("no-such-ask") });

        const response = yield* Effect.promise(() =>
          askMarkdownHandler(platformOf(calls))({
            params: params("no-such-ask"),
            request: get("/datekit/asks/no-such-ask.md"),
          })
        );

        const seen = yield* read(response);

        expect(seen.status).toBe(404);
        expect(seen.contentType).toBe(MARKDOWN);
        expect(seen.body).toBe(
          [
            "```text",
            ...explain([refusal]),
            "```",
            "",
            `Next: \`${Brand.cli} asks\``,
            "",
          ].join("\n")
        );
        expect(seen.cacheControl).toBe("no-store");
      })
  );

  it.effect(
    "answers an unknown project with 404 and the UnknownProject refusal",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const response = yield* Effect.promise(() =>
          askMarkdownHandler(platformOf(calls))({
            params: params(askId, "nowhere"),
            request: get(`/nowhere/asks/${askId}.md`),
          })
        );

        const seen = yield* read(response);

        expect(seen.status).toBe(404);
        expect(seen.body).toBe(
          refusalsMarkdown([
            new UnknownProject({ project: ProjectName.make("nowhere") }),
          ])
        );
        expect(seen.body).toContain(
          "UnknownProject: no project is named nowhere"
        );
      })
  );

  it.effect(
    "answers a path that can name no ask with 404, and asks the platform nothing",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const response = yield* Effect.promise(() =>
          askMarkdownHandler(platformOf(calls))({
            params: params("Not_An-Ask"),
            request: get("/datekit/asks/Not_An-Ask.md"),
          })
        );

        const seen = yield* read(response);

        expect(seen.status).toBe(404);
        expect(seen.contentType).toBe(MARKDOWN);
        expect(seen.body).toContain("Not_An-Ask");
        expect(yield* Ref.get(calls)).toBe(0);
      })
  );

  it.effect(
    "answers 502 when the platform does not answer, and keeps it out of caches",
    () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          askMarkdownHandler(unreachable)({
            params: params(askId),
            request: get(`/datekit/asks/${askId}.md`),
          })
        );

        const seen = yield* read(response);

        expect(seen.status).toBe(502);
        expect(seen.contentType).toBe(MARKDOWN);
        expect(seen.cacheControl).toBe("no-store");
      })
  );
});

describe("the ask page", () => {
  it("names its Markdown as an alternate, and says it varies by Accept", () => {
    expect(askPageHeaders({ params: params(askId) })).toStrictEqual({
      link: `</datekit/asks/${askId}.md>; rel="alternate"; type="text/markdown"`,
      vary: "Accept",
    });
  });

  it("names no alternate for a path that can name no ask, so no raw path text reaches a header", () => {
    expect(
      askPageHeaders({ params: params('x>; rel="next"\nset-cookie: a=b') })
    ).toStrictEqual({ vary: "Accept" });
  });
});

describe(askMarkdownResponse, () => {
  it.effect(
    "never lets a cache keep the answer of a contract only maintainers may see",
    () =>
      Effect.gen(function* () {
        const seen = yield* read(
          askMarkdownResponse(Exit.succeed({ brief }), "maintainers", index)
        );

        expect([seen.status, seen.cacheControl, seen.body]).toStrictEqual([
          200,
          "private, no-store",
          served,
        ]);
      })
  );
});

describe("an ask's Markdown with the index named", () => {
  it.effect(
    "opens with the banner naming its project's llms.txt, then the brief unchanged",
    () =>
      Effect.gen(function* () {
        const seen = yield* read(
          askMarkdownResponse(Exit.succeed({ brief }), "public", index)
        );

        expect(seen.status).toBe(200);
        expect(seen.body).toBe(served);
        expect(seen.body.split("\n")[0]).toContain(
          `${WEB}/${project}/llms.txt`
        );
      })
  );

  it.effect("keeps a refusal's Markdown as it is, with no banner", () =>
    Effect.gen(function* () {
      const refusal = new UnknownAsk({ ask: AskId.make("no-such-ask") });

      const seen = yield* read(
        askMarkdownResponse(Exit.fail(refusal), "public", index)
      );

      expect([seen.status, seen.body]).toStrictEqual([
        404,
        refusalsMarkdown([refusal]),
      ]);
    })
  );
});

describe(refusalsMarkdown, () => {
  it("sets every refusal's explain lines in one text block, then each distinct next command once", () => {
    const refusals = [
      new UnknownProject({ project: ProjectName.make("nowhere") }),
      new UnknownAsk({ ask: askId }),
    ] as const;

    expect(refusalsMarkdown(refusals)).toBe(
      [
        "```text",
        ...explain(refusals),
        "```",
        "",
        `Next: \`${Brand.cli} asks\``,
        "",
      ].join("\n")
    );
  });
});

const accepting = (accept: string | undefined) =>
  wantsMarkdown(get("/datekit/asks/parse-iso-week", accept));

describe(wantsMarkdown, () => {
  it.each([
    ["text/markdown"],
    ["text/markdown, text/html"],
    ["text/html;q=0.9, text/markdown"],
    ["text/markdown;q=0.8, */*;q=0.1"],
    ["Text/Markdown; charset=utf-8"],
  ])("serves Markdown to %o", (accept) => {
    expect(accepting(accept)).toBeTruthy();
  });

  it.each([
    [undefined],
    ["*/*"],
    ["text/*"],
    ["text/html"],
    [BROWSER],
    ["text/markdown;q=0.5, text/html"],
    ["text/markdown;q=0, text/html;q=0.1"],
    ["text/markdown;q=0"],
    ["application/json"],
  ])("serves the page to %o", (accept) => {
    expect(accepting(accept)).toBeFalsy();
  });
});
