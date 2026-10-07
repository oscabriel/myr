import { NodeHttpServer } from "@effect/platform-node";
import { CommitSha } from "@repo/protocol/ids";
import { Context, Effect, FileSystem, Layer } from "effect";
import type { Option } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";

import { Custody } from "../src/custody.ts";
import { gateway } from "../src/gateway.ts";
import { Upstream } from "../src/upstream.ts";
import { gitOk } from "./git.ts";
import { httpBackend } from "./http-backend.ts";

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
 * A bare upstream repo `demo.git` whose `main` holds one commit, a `seed`
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
    const upstream = `${root}/demo.git`;
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
            httpBackend(
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
      url: `http://127.0.0.1:${address.port}/demo.git`,
    };
  });
