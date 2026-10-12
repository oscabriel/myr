// The request travels at the platform's own URL, never the web's: the platform names git remotes from the origin it is handed.
// The session cookie becomes `Authorization`; the browser's own cookies and any `authorization` it set never leave the web.
// A 401 (a credential the platform cannot verify) is asked again with no credential, and the answer expires the cookie.
import { Effect, Option } from "effect";

import type { Backend } from "./rpc.ts";
import {
  clearedCookies,
  credentialFrom,
  settingCookies,
  withCredential,
} from "./session.ts";

const onPlatform = (request: Request, platformUrl: string) => {
  const { pathname, search } = new URL(request.url);

  return new Request(new URL(`${pathname}${search}`, platformUrl), request);
};

const expiringSession = (response: Response) =>
  new Response(response.body, {
    headers: settingCookies(response.headers, clearedCookies()),
    status: response.status,
    statusText: response.statusText,
  });

const send = (env: Env, request: Request) =>
  Effect.promise(() => env.PLATFORM.fetch(request));

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
