/**
 * `#backend`'s production target: the request goes to the platform over the
 * `PLATFORM` service binding, with no network hop and no CORS.
 *
 * It travels at the platform's own URL (`PUBLIC_PLATFORM_URL`), never the
 * web's: the platform names a project's and a claim's git remote from the
 * origin of the request it is handed (W3 312 #2), and a remote on the web's
 * host would lead nowhere. Method and body are kept; the browser's session
 * cookie becomes the HTTP `Authorization` header, the only credential the
 * platform reads (W3 305 #2), and the browser's own cookies and any
 * `authorization` it set never leave the web (`session.ts`, issue 513).
 *
 * A session the platform no longer knows (it answers 401 to a credential
 * it cannot verify, and only then) is not a refusal of the call: the call is
 * asked again with no credential, so a public read still answers and a
 * signed-in one says `Unauthenticated`, and the answer expires the cookie.
 */
import { Effect, Option } from "effect";

import type { Backend } from "./rpc.ts";
import {
  clearedCookie,
  credentialFrom,
  settingCookies,
  withCredential,
} from "./session.ts";

/** `request` as the platform's own: the same path and query on its origin. */
const onPlatform = (request: Request, platformUrl: string) => {
  const { pathname, search } = new URL(request.url);

  return new Request(new URL(`${pathname}${search}`, platformUrl), request);
};

/** `response` as it came, also expiring the session cookie. */
const expiringSession = (response: Response) =>
  new Response(response.body, {
    headers: settingCookies(response.headers, [clearedCookie()]),
    status: response.status,
    statusText: response.statusText,
  });

const send = (env: Env, request: Request) =>
  Effect.promise(() => env.PLATFORM.fetch(request));

/** The request's body read whole, so the call can be asked twice; none for a GET or HEAD. */
const bodyOf = (request: Request) =>
  request.method === "GET" || request.method === "HEAD"
    ? Effect.succeed(null)
    : Effect.promise(() => request.arrayBuffer());

export const backend: Backend = (request, env) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const platform = onPlatform(request, env.PUBLIC_PLATFORM_URL);
      const credential = credentialFrom(request);

      if (Option.isNone(credential)) {
        return yield* send(env, withCredential(platform, credential));
      }

      const body = yield* bodyOf(platform);

      const asked = (token: Option.Option<string>) =>
        withCredential(
          body === null
            ? platform
            : new Request(platform, { body, method: platform.method }),
          token
        );

      const answer = yield* send(env, asked(credential));

      if (answer.status !== 401) {
        return answer;
      }

      yield* Effect.promise(() => answer.body?.cancel() ?? Promise.resolve());

      return expiringSession(yield* send(env, asked(Option.none())));
    })
  );
