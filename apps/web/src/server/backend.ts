/**
 * `#backend`'s production target: the request goes to the platform over the
 * `PLATFORM` service binding, with no network hop and no CORS.
 *
 * It travels at the platform's own URL (`PUBLIC_PLATFORM_URL`), never the
 * web's: the platform names a project's and a claim's git remote from the
 * origin of the request it is handed (W3 312 #2), and a remote on the web's
 * host would lead nowhere. Method, headers and body are kept, and nothing is
 * added: the browser's session becomes a bearer token here in issue 513,
 * never before.
 */
import type { Backend } from "./rpc.ts";

/** `request` as the platform's own: the same path and query on its origin. */
const onPlatform = (request: Request, platformUrl: string) => {
  const { pathname, search } = new URL(request.url);

  return new Request(new URL(`${pathname}${search}`, platformUrl), request);
};

export const backend: Backend = (request, env) =>
  env.PLATFORM.fetch(onPlatform(request, env.PUBLIC_PLATFORM_URL));
