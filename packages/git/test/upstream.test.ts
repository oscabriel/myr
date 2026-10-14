import { describe, expect, it } from "@effect/vitest";
import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { RepoHost, RepoName, RepoNotFound } from "@repo/artifacts/repo-host";
import type { TokenScope } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import {
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Ref,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";

import { Exchange, Upstream, UpstreamFailure } from "../src/upstream.ts";
import { UpstreamRepoHost } from "../src/upstream/repo-host.ts";

const repo = RepoName.make("demo");

interface Minted {
  readonly scope: TokenScope;
  readonly secret: string;
  readonly expiresAt: DateTime.Utc;
}

interface Seen {
  readonly requests: Ref.Ref<readonly Request[]>;
  readonly minted: Ref.Ref<readonly Minted[]>;
}

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

  // On Workers a request that awaits another request's I/O is cancelled as hung,
  // and one whose client left is cancelled where it stands: its mint never ends.
  it.live(
    "never has an exchange wait on a token another exchange is minting",
    () =>
      Effect.gen(function* () {
        const mints = yield* Ref.make(0);
        const requests = yield* Ref.make<readonly Request[]>([]);

        const stalling = Layer.effect(
          RepoHost,
          Effect.gen(function* () {
            const host = yield* RepoHost;

            return RepoHost.of({
              ...host,
              mintToken: (name, scope, ttl) =>
                Effect.flatMap(
                  Ref.getAndUpdate(mints, (count) => count + 1),
                  (count) =>
                    count === 0
                      ? Effect.never
                      : host.mintToken(name, scope, ttl)
                ),
            });
          })
        ).pipe(Layer.provide(RepoHostMemory));

        const later = yield* Effect.gen(function* () {
          yield* RepoHost.use((host) => host.create(repo)).pipe(Effect.orDie);

          const upstream = yield* Upstream;

          const abandoned = yield* Effect.forkChild(
            upstream.exchange(repo, advertise)
          );

          yield* Effect.yieldNow;

          const answered = yield* Effect.timeoutOption(
            Effect.as(upstream.exchange(repo, advertise), "answered"),
            "2 seconds"
          );

          yield* Fiber.interrupt(abandoned);

          return answered;
        }).pipe(
          Effect.provide(
            UpstreamRepoHost.pipe(
              Layer.provideMerge(Layer.mergeAll(stalling, recording(requests)))
            )
          )
        );

        expect(later).toStrictEqual(Option.some("answered"));
        expect(yield* Ref.get(mints)).toBe(2);
      })
  );

  it.effect("calls a request that got no response an UpstreamFailure", () =>
    Effect.gen(function* () {
      const unreachable = Layer.succeed(
        Fetch,
        Fetch.of({
          fetch: (request) =>
            Effect.fail(
              new FetchFailed({ reason: "connection reset", url: request.url })
            ),
        })
      );

      const minted = yield* Ref.make<readonly Minted[]>([]);

      const failure = yield* Effect.gen(function* () {
        yield* RepoHost.use((host) => host.create(repo)).pipe(Effect.orDie);

        return yield* Upstream.use((upstream) =>
          upstream.exchange(repo, advertise)
        ).pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          UpstreamRepoHost.pipe(
            Layer.provideMerge(Layer.mergeAll(store(minted), unreachable))
          )
        )
      );

      expect(failure).toStrictEqual(
        new UpstreamFailure({ reason: "connection reset", repo })
      );
    })
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
