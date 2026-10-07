import type { RepoName } from "@repo/artifacts/repo-host";
import { Effect, Option, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { Exchange, Upstream } from "../src/upstream.ts";
import { spawn } from "./git.ts";

const concat = (chunks: readonly Uint8Array[]) => {
  const all = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }

  return all;
};

const blankLine = (bytes: Uint8Array) => {
  for (let at = 0; at + 3 < bytes.length; at += 1) {
    if (
      bytes[at] === 13 &&
      bytes[at + 1] === 10 &&
      bytes[at + 2] === 13 &&
      bytes[at + 3] === 10
    ) {
      return at;
    }
  }

  return -1;
};

/** A CGI reply (`Status:` and headers, a blank line, the body) as a Response. */
const fromCgi = (output: Uint8Array) => {
  const cut = blankLine(output);
  const head = new TextDecoder().decode(output.slice(0, Math.max(cut, 0)));
  const headers = new Headers();
  let status = 200;

  for (const line of head.split("\r\n")) {
    const [name = "", ...rest] = line.split(": ");
    const value = rest.join(": ");

    if (name.toLowerCase() === "status") {
      status = Number(value.split(" ")[0]);
    } else if (name !== "") {
      headers.append(name, value);
    }
  }

  return new Response(output.slice(cut + 4), { headers, status });
};

const cgi = (root: string, repo: RepoName, exchange: Exchange) => {
  const header = (name: string) => exchange.headers.get(name) ?? "";

  const request = Exchange.$match(exchange, {
    Advertise: ({ service }) => ({
      PATH_INFO: `/${repo}.git/info/refs`,
      QUERY_STRING: `service=${service}`,
      REQUEST_METHOD: "GET",
    }),
    Call: ({ service }) => ({
      PATH_INFO: `/${repo}.git/${service}`,
      QUERY_STRING: "",
      REQUEST_METHOD: "POST",
    }),
  });

  return {
    ...request,
    CONTENT_TYPE: header("content-type"),
    GIT_HTTP_EXPORT_ALL: "1",
    GIT_PROJECT_ROOT: root,
    GIT_PROTOCOL: header("git-protocol"),
    HTTP_CONTENT_ENCODING: header("content-encoding"),
    REMOTE_ADDR: "127.0.0.1",
    // http-backend serves receive-pack only to an authenticated user.
    REMOTE_USER: "gateway",
  };
};

/**
 * `git http-backend` over the bare repos in `root`, as the gateway's
 * upstream. Like Artifacts, it takes no credentials from the client: an
 * exchange carrying any is refused. `atPush` runs as each receive-pack call
 * arrives, so a test can move a ref under a push; a reply it gives stands in
 * for the upstream's.
 */
export const httpBackend = (
  root: string,
  atPush: Effect.Effect<
    Option.Option<Response>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > = Effect.succeedNone
) =>
  Effect.map(
    Effect.context<ChildProcessSpawner.ChildProcessSpawner>(),
    (context) =>
      Upstream.of({
        exchange: (repo, exchange) =>
          Effect.scoped(
            Effect.gen(function* () {
              if (exchange.headers.has("authorization")) {
                return new Response(
                  "the client's credentials reached the upstream",
                  {
                    status: 400,
                  }
                );
              }

              const stdin = Exchange.$match(exchange, {
                Advertise: () => "ignore" as const,
                Call: ({ body }) =>
                  Stream.fromReadableStream({
                    evaluate: () => body,
                    onError: (cause) => cause,
                  }).pipe(Stream.orDie),
              });

              const instead =
                Exchange.$is("Call")(exchange) &&
                exchange.service === "git-receive-pack"
                  ? yield* atPush
                  : Option.none();

              if (Option.isSome(instead)) {
                if (stdin !== "ignore") {
                  yield* Stream.runDrain(stdin);
                }

                return instead.value;
              }

              const child = yield* spawn("git", ["http-backend"], {
                env: cgi(root, repo, exchange),
                stdin,
              });

              const output = yield* Stream.runCollect(child.stdout).pipe(
                Effect.orDie
              );

              return fromCgi(concat(output));
            })
          ).pipe(Effect.provide(context)),
      })
  );
