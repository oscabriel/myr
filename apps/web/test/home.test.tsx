/**
 * `/home`, a signed-in reader's own page, read on the server with their
 * session from the dev world and its fixtures: their claims with where each
 * answer stands, the decisions waiting when they decide somewhere, the asks
 * they may take, and their record. Signed out, it says what the page is
 * and how to sign in. A page about its reader, kept by no cache.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { Handle } from "@repo/protocol/ids";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { devServer } from "../src/dev/server.ts";
import { devToken } from "../src/dev/sessions.ts";
import { HomeView } from "../src/features/home/home-page.tsx";
import { HomePageData, readHome } from "../src/features/home/read.ts";
import { homeHeaders, Route } from "../src/routes/home.tsx";
import { renderAt } from "./render.tsx";

/** A `Client` of a fresh dev world with its fixtures, signed in as `handle` (or as nobody). */
const fixturesClient = (handle?: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { dispose, handler } = devServer({ fixtures: "on" });

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      return Layer.effect(Client)(RpcClient.make(Contracts)).pipe(
        Layer.provide(
          RpcClient.layerProtocolHttp({
            transformClient: HttpClient.mapRequest((request) =>
              handle === undefined
                ? request
                : HttpClientRequest.bearerToken(
                    request,
                    devToken(Handle.make(handle))
                  )
            ),
            url: "http://localhost/rpc",
          })
        ),
        Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
        Layer.provide(
          Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
            handler(new Request(input, init))
          )
        )
      );
    })
  );

/** The page as the route renders it from what `readHome` sent. */
const pageFrom = (encoded: typeof HomePageData.Encoded) =>
  Effect.gen(function* () {
    const data = yield* Schema.decodeEffect(HomePageData)(encoded);

    return yield* renderAt(
      "/home",
      <HomeView now={data.now} read={data.read} />
    );
  });

const textIn = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll(/\s+/gu, " ")
    .trim();

/** The sections' names, in order. */
const sectionsOf = (markup: string) =>
  [...markup.matchAll(/<section\b[^>]*aria-label="(?<name>[^"]+)"/gu)].map(
    (found) => found.groups?.name
  );

describe("home, read on the server with the reader's session", () => {
  it.live(
    "gives a contributor their claims, the asks they may take and their record, and no decisions",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageFrom(yield* readHome);

        expect(sectionsOf(markup)).toStrictEqual([
          "Your claims",
          "Asks you may take",
        ]);
        expect(markup).toMatch(/data-claim="[^"]+"[^>]*data-project="vellum"/u);
        expect(markup).toContain('href="/people/bram"');
        expect(markup).toContain('href="/asks"');
      }).pipe(Effect.provide(fixturesClient("bram")), Effect.scoped),
    60_000
  );

  it.live(
    "gives a decider the decisions waiting for them, each linking its page, and Today",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageFrom(yield* readHome);

        expect(sectionsOf(markup)).toContain("Decisions waiting");
        expect(markup).toMatch(/href="\/[a-z-]+\/decisions\/[^"]+"/u);
        expect(markup).toContain('href="/today"');
      }).pipe(Effect.provide(fixturesClient("ines-v")), Effect.scoped),
    60_000
  );

  it.live(
    "signed out, says what the page is, how to sign in and come back, and the command",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageFrom(yield* readHome);

        expect(textIn(markup)).toContain(`${Brand.cli} status`);
        expect(markup).toContain(
          `href="/auth/signin?return=${encodeURIComponent("/home")}"`
        );
        expect(sectionsOf(markup)).toStrictEqual([]);
      }).pipe(Effect.provide(fixturesClient()), Effect.scoped),
    60_000
  );

  it("is kept by no cache: its response is private and never stored", () => {
    expect(Route.options.headers).toBe(homeHeaders);
    expect(homeHeaders()).toStrictEqual({
      "Cache-Control": "private, no-store",
    });
  });
});
