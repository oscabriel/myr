import { NodeHttpServer } from "@effect/platform-node";
import type { RepoName } from "@repo/artifacts/repo-host";
import { CommitSha } from "@repo/protocol/ids";
import { gitOk } from "@repo/testkit/git";
import { httpBackend } from "@repo/testkit/http-backend";
import { Context, Effect, FileSystem, Layer, Option, Stream } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";

import { Custody } from "../src/custody.ts";
import { gateway } from "../src/gateway.ts";
import { Exchange, Upstream } from "../src/upstream.ts";

/** Custody that lets every push through. */
export const admitAll = Custody.of({
  admit: () => Effect.succeed([]),
  review: () => Effect.succeed([]),
});

/** Writes the files, commits them all, and returns the commit's id. */
export const commit = (
  cwd: string,
  message: string,
  files: Readonly<Record<string, string>>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    for (const [path, content] of Object.entries(files)) {
      yield* fs.writeFileString(`${cwd}/${path}`, content).pipe(Effect.orDie);
    }

    yield* gitOk(cwd, "add", "--all");
    yield* gitOk(cwd, "commit", "--quiet", "--message", message);

    return CommitSha.make(yield* gitOk(cwd, "rev-parse", "HEAD"));
  });

/** An exchange as the HTTP request a smart-HTTP server would get. */
const requestOf = (repo: RepoName, exchange: Exchange) =>
  Exchange.$match(exchange, {
    Advertise: ({ headers, service }) =>
      Effect.succeed(
        new Request(
          `http://upstream/${repo}.git/info/refs?service=${service}`,
          { headers }
        )
      ),
    // Read whole: a streamed request body needs Node's `duplex` option, which
    // the Workers types lack.
    Call: ({ body, headers, service }) =>
      Stream.fromReadableStream({
        evaluate: () => body,
        onError: (cause) => cause,
      }).pipe(
        Stream.runCollect,
        Effect.orDie,
        Effect.map(
          (chunks) =>
            new Request(`http://upstream/${repo}.git/${service}`, {
              body: new Blob(chunks),
              headers,
              method: "POST",
            })
        )
      ),
  });

/**
 * `git http-backend` over the bare repos in `root`, as the gateway's
 * upstream. Like Artifacts, it takes no credentials from the client: an
 * exchange carrying any is refused. `atPush` runs as each receive-pack call
 * arrives, so a test can move a ref under a push; a reply it gives stands in
 * for the upstream's.
 */
const upstreamAt = (
  root: string,
  atPush: Effect.Effect<
    Option.Option<Response>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  >
) =>
  Effect.map(
    Effect.context<ChildProcessSpawner.ChildProcessSpawner>(),
    (context) => {
      const serve = httpBackend(root);

      return Upstream.of({
        exchange: (repo, exchange) =>
          Effect.scoped(
            Effect.gen(function* () {
              if (exchange.headers.has("authorization")) {
                return new Response(
                  "the client's credentials reached the upstream",
                  { status: 400 }
                );
              }

              const instead =
                Exchange.$is("Call")(exchange) &&
                exchange.service === "git-receive-pack"
                  ? yield* atPush
                  : Option.none();

              const request = yield* requestOf(repo, exchange);

              return Option.isSome(instead)
                ? instead.value
                : yield* serve(request);
            })
          ).pipe(Effect.provide(context)),
      });
    }
  );

const app = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const response = yield* gateway(yield* HttpServerRequest.toWeb(request));

  return HttpServerResponse.fromWeb(response);
}).pipe(Effect.orDie);

/** The two repos a test reaches past the gateway. */
export interface Repos {
  /** A work tree that pushes to the upstream directly. */
  readonly seed: string;
  /** The bare repo behind the gateway. */
  readonly upstream: string;
}

/**
 * A bare upstream repo `alice_demo.git`, the project `alice/demo`'s, whose
 * `main` holds one commit, a `seed`
 * clone that pushes to it directly, and the gateway in front of it on a
 * local port, judging pushes with `custody`. `atPush` runs as each push
 * reaches the upstream; a reply it gives stands in for the upstream's.
 */
export const world = (
  custody: Custody["Service"],
  atPush: (
    repos: Repos
  ) => Effect.Effect<
    Option.Option<Response>,
    never,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
  > = () => Effect.succeedNone
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
    const upstream = `${root}/alice_demo.git`;
    const seed = `${root}/seed`;

    yield* gitOk(
      root,
      "init",
      "--quiet",
      "--bare",
      "--initial-branch=main",
      upstream
    );
    yield* gitOk(root, "init", "--quiet", "--initial-branch=main", seed);
    yield* commit(seed, "first", { "README.md": "demo\n" });
    yield* gitOk(seed, "push", "--quiet", upstream, "HEAD:refs/heads/main");

    const served = yield* Layer.build(
      HttpServer.serve(app).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
        Layer.provide(
          Layer.effect(
            Upstream,
            upstreamAt(
              root,
              atPush({ seed, upstream }).pipe(
                Effect.provideService(FileSystem.FileSystem, fs)
              )
            )
          )
        ),
        Layer.provide(Layer.succeed(Custody, custody))
      )
    ).pipe(Effect.orDie);

    const { address } = Context.get(served, HttpServer.HttpServer);

    if (!("port" in address)) {
      return yield* Effect.die("the gateway listens on a unix socket");
    }

    return {
      root,
      seed,
      upstream,
      url: `http://127.0.0.1:${address.port}/alice/demo.git`,
    };
  });
