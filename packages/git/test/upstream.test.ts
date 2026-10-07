import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { RepoHost, RepoName, RepoNotFound } from "@repo/artifacts/repo-host";
import type { TokenScope } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import {
  DateTime,
  Duration,
  Effect,
  Layer,
  Redacted,
  Ref,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";

import { Exchange, Upstream } from "../src/upstream.ts";
import { UpstreamRepoHost } from "../src/upstream/repo-host.ts";

const repo = RepoName.make("demo");

/** A token the store minted: its scope, its secret and when it expires. */
interface Minted {
  readonly scope: TokenScope;
  readonly secret: string;
  readonly expiresAt: DateTime.Utc;
}

/** What one test sees: every request sent upstream and every token minted. */
interface Seen {
  readonly requests: Ref.Ref<readonly Request[]>;
  readonly minted: Ref.Ref<readonly Minted[]>;
}

/**
 * The memory store, minting tokens shaped like Artifacts' (a secret, then
 * `?expires=`), with each mint written to `minted`.
 */
const store = (minted: Seen["minted"]) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        mintToken: (name, scope, ttl) =>
          Effect.gen(function* () {
            const token = yield* host.mintToken(name, scope, ttl);
            const secret = Redacted.value(token.secret);

            yield* Ref.update(minted, (all) => [
              ...all,
              { expiresAt: token.expiresAt, scope, secret },
            ]);

            return {
              ...token,
              secret: Redacted.make(
                `${secret}?expires=${DateTime.toEpochMillis(token.expiresAt) / 1000}`
              ),
            };
          }),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));

/** A `Fetch` that writes down each request and answers 200. */
const recording = (requests: Seen["requests"]) =>
  Layer.succeed(
    Fetch,
    Fetch.of({
      fetch: (request) =>
        Ref.update(requests, (all) => [...all, request]).pipe(
          Effect.as(new Response("upstream"))
        ),
    })
  );

const world = (seen: Seen) =>
  UpstreamRepoHost.pipe(
    Layer.provideMerge(
      Layer.mergeAll(store(seen.minted), recording(seen.requests))
    )
  );

const advertise = Exchange.Advertise({
  headers: new Headers({ "git-protocol": "version=2" }),
  service: "git-upload-pack",
});

/** Runs `body` against the upstream over the memory store, with `demo` created. */
const withUpstream = <A, E>(
  body: (seen: Seen) => Effect.Effect<A, E, Upstream | RepoHost>
) =>
  Effect.gen(function* () {
    const seen: Seen = {
      minted: yield* Ref.make<readonly Minted[]>([]),
      requests: yield* Ref.make<readonly Request[]>([]),
    };

    return yield* Effect.gen(function* () {
      yield* RepoHost.use((host) => host.create(repo)).pipe(Effect.orDie);

      return yield* body(seen);
    }).pipe(Effect.provide(world(seen)));
  });

const basic = (secret: string) => `Basic ${btoa(`x:${secret}`)}`;

/** What the upstream sent: the method, the URL and the headers that matter. */
const sent = (request: Request) => ({
  authorization: request.headers.get("authorization"),
  method: request.method,
  protocol: request.headers.get("git-protocol"),
  url: request.url,
});

describe("the upstream over RepoHost", () => {
  it.effect(
    "advertises refs at the repo's remote with a minted read token",
    () =>
      withUpstream((seen) =>
        Effect.gen(function* () {
          const upstream = yield* Upstream;
          const response = yield* upstream.exchange(repo, advertise);
          const remote = yield* RepoHost.use((host) => host.remote(repo));
          const minted = yield* Ref.get(seen.minted);

          expect(yield* Effect.promise(() => response.text())).toBe("upstream");
          expect({
            requests: (yield* Ref.get(seen.requests)).map(sent),
            scopes: minted.map(({ scope }) => scope),
          }).toStrictEqual({
            requests: [
              {
                authorization: basic(minted[0]?.secret ?? ""),
                method: "GET",
                protocol: "version=2",
                url: `${remote}/info/refs?service=git-upload-pack`,
              },
            ],
            scopes: ["read"],
          });
        })
      )
  );

  it.effect("posts a receive-pack call with a write token", () =>
    withUpstream((seen) =>
      Effect.gen(function* () {
        const upstream = yield* Upstream;
        const remote = yield* RepoHost.use((host) => host.remote(repo));

        yield* upstream.exchange(
          repo,
          Exchange.Call({
            body: Stream.toReadableStream(
              Stream.make(new TextEncoder().encode("0000"))
            ),
            headers: new Headers({
              "content-type": "application/x-git-receive-pack-request",
            }),
            service: "git-receive-pack",
          })
        );

        const [request] = yield* Ref.get(seen.requests);
        const minted = yield* Ref.get(seen.minted);

        expect({
          request: request === undefined ? undefined : sent(request),
          scopes: minted.map(({ scope }) => scope),
        }).toStrictEqual({
          request: {
            authorization: basic(minted[0]?.secret ?? ""),
            method: "POST",
            protocol: null,
            url: `${remote}/git-receive-pack`,
          },
          scopes: ["write"],
        });
        expect(
          yield* Effect.promise(() => request?.text() ?? Promise.resolve(""))
        ).toBe("0000");
      })
    )
  );

  it.effect(
    "mints once while the token lasts, and again a minute before it expires",
    () =>
      withUpstream((seen) =>
        Effect.gen(function* () {
          const upstream = yield* Upstream;

          yield* upstream.exchange(repo, advertise);
          yield* upstream.exchange(repo, advertise);

          const first = yield* Ref.get(seen.minted);

          expect(first).toHaveLength(1);

          // The token is used until a minute before it expires.
          const lasts = Duration.subtract(
            DateTime.distance(
              yield* DateTime.now,
              first[0]?.expiresAt ?? DateTime.makeUnsafe(0)
            ),
            Duration.seconds(60)
          );

          yield* TestClock.adjust(
            Duration.subtract(lasts, Duration.seconds(1))
          );
          yield* upstream.exchange(repo, advertise);

          expect(yield* Ref.get(seen.minted)).toHaveLength(1);

          yield* TestClock.adjust(Duration.seconds(1));
          yield* upstream.exchange(repo, advertise);

          const minted = yield* Ref.get(seen.minted);
          const requests = yield* Ref.get(seen.requests);

          expect(minted).toHaveLength(2);
          expect(requests.at(-1)?.headers.get("authorization")).toBe(
            basic(minted[1]?.secret ?? "")
          );
        })
      )
  );

  it.effect("passes RepoNotFound through for a repo the store lacks", () =>
    withUpstream(() =>
      Effect.gen(function* () {
        const upstream = yield* Upstream;
        const missing = RepoName.make("missing");

        expect(
          yield* upstream.exchange(missing, advertise).pipe(
            Effect.match({
              onFailure: (error) => error,
              onSuccess: () => "forwarded",
            })
          )
        ).toStrictEqual(new RepoNotFound({ name: missing }));
      })
    )
  );
});
