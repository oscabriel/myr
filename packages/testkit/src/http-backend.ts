import { Effect, Stream } from "effect";
import type { Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";

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

/** `…/<repo>.git/info/refs` and the two service calls: what smart HTTP asks for. */
const SMART_HTTP =
  /\/(?<repo>[^/]+)\.git\/(?<path>info\/refs|git-upload-pack|git-receive-pack)$/u;

const notFound = () =>
  new Response("not a smart-HTTP git URL", { status: 404 });

/**
 * Passes bytes and fails the stream on anything else: the Workers types leave
 * a request body's chunk type open.
 */
const bytes = () =>
  new TransformStream<unknown, Uint8Array>({
    transform: (chunk, controller) => {
      if (chunk instanceof Uint8Array) {
        controller.enqueue(chunk);
      } else {
        controller.error(
          new TypeError("a request body held something other than bytes")
        );
      }
    },
  });

/** A request's body as the CGI's stdin; a request without one gives none. */
const stdinOf = (request: Request) => {
  const { body } = request;

  return body === null
    ? ("ignore" as const)
    : Stream.fromReadableStream({
        evaluate: () => body.pipeThrough(bytes()),
        onError: (cause) => cause,
      }).pipe(Stream.orDie);
};

/**
 * `git http-backend` over the bare repos in `root`: a smart-HTTP server for
 * `…/<repo>.git/info/refs`, `…/git-upload-pack` and `…/git-receive-pack`,
 * whatever comes before the repo in the URL. It serves receive-pack too, and
 * reads no credentials: a test that wants a server to refuse them, or to stand
 * in for a reply, wraps this handler.
 */
export const httpBackend =
  (root: string) =>
  (
    request: Request
  ): Effect.Effect<
    Response,
    never,
    ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
  > =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const route = SMART_HTTP.exec(url.pathname)?.groups;

      if (route === undefined) {
        return notFound();
      }

      const header = (name: string) => request.headers.get(name) ?? "";

      const child = yield* spawn("git", ["http-backend"], {
        env: {
          CONTENT_TYPE: header("content-type"),
          GIT_HTTP_EXPORT_ALL: "1",
          GIT_PROJECT_ROOT: root,
          GIT_PROTOCOL: header("git-protocol"),
          HTTP_CONTENT_ENCODING: header("content-encoding"),
          PATH_INFO: `/${route.repo}.git/${route.path}`,
          QUERY_STRING: url.search.replace(/^\?/u, ""),
          REMOTE_ADDR: "127.0.0.1",
          // http-backend serves receive-pack only to an authenticated user.
          REMOTE_USER: "tester",
          REQUEST_METHOD: request.method,
        },
        stdin: stdinOf(request),
      });

      const output = yield* Stream.runCollect(child.stdout).pipe(Effect.orDie);

      return fromCgi(concat(output));
    });
