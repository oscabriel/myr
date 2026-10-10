/**
 * What the edge may keep of the web's answers (ADR 0026). Workers Cache
 * stands in front of the deployed web Worker and keys an answer by its path
 * and query string alone: not by the host, and not by the `Cookie` or the
 * `Authorization` a request carries. A request with a cookie is served what
 * the cache holds for its path, unless the stored answer varies by
 * `Cookie`; an answer without `Cache-Control` is kept by a heuristic (two
 * hours for a 200). Every answer the Worker gives passes through
 * `forTheEdge` (`src/server.ts`), which holds two rules:
 *
 * - An answer to a request that carries any cookie or an `Authorization`,
 *   an answer that sets a cookie, and an answer that says nothing of how
 *   long it may be kept, is kept nowhere: `private, no-store`, which the
 *   cache bypasses. So nothing read with a reader's credential is ever
 *   stored, and a route that forgets its headers keeps nothing.
 * - Any other answer the cache may store varies by `Cookie`: it was made for
 *   a request with no cookie, and is served only to one, so a signed-in
 *   reader is never handed a page kept from a signed-out one.
 *
 * `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control` would outrank
 * `Cache-Control` at the edge; the web sets neither, and drops any an
 * answer it passes on carries.
 */
import { Effect } from "effect";

/** The `Cache-Control` of an answer kept by nobody: no shared cache, no browser. */
export const KEPT_NOWHERE = "private, no-store";

/** Headers that would decide what the edge keeps over `Cache-Control`. */
const EDGE_OVERRIDES = ["cdn-cache-control", "cloudflare-cdn-cache-control"];

/** The directives of a `Cache-Control` value, each as `name` or `name=value`, lower-cased. */
const directivesOf = (cacheControl: string) =>
  cacheControl
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter((directive) => directive !== "");

/** Whether the request says who is reading it: any cookie, or an `Authorization`. */
const speaksForSomeone = (request: Request) =>
  request.headers.has("cookie") || request.headers.has("authorization");

/**
 * Whether `cacheControl` must be replaced by `KEPT_NOWHERE`: it is missing,
 * or it names a field (`private="set-cookie"`, `no-cache="…"`), the form
 * that lets the cache store the answer with that field stripped.
 */
const unsafeFor = (cacheControl: string | null) =>
  cacheControl === null ||
  directivesOf(cacheControl).some(
    (directive) =>
      directive.startsWith("private=") || directive.startsWith("no-cache=")
  );

/** Whether the cache bypasses an answer under `cacheControl`. */
const keptNowhere = (cacheControl: string) =>
  directivesOf(cacheControl).some(
    (directive) => directive === "private" || directive === "no-store"
  );

/** `vary` with `Cookie` among its headers. */
const varyingByCookie = (vary: string | null) => {
  const names = (vary ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

  return names.some((name) => name.toLowerCase() === "cookie")
    ? names.join(", ")
    : [...names, "Cookie"].join(", ");
};

/** `response`'s headers as the edge may see them, for `request`. */
const edgeHeaders = (request: Request, response: Response) => {
  const headers = new Headers(response.headers);

  for (const name of EDGE_OVERRIDES) {
    headers.delete(name);
  }

  const cacheControl = headers.get("cache-control");

  if (
    speaksForSomeone(request) ||
    headers.has("set-cookie") ||
    unsafeFor(cacheControl)
  ) {
    headers.set("cache-control", KEPT_NOWHERE);

    return headers;
  }

  if (cacheControl !== null && !keptNowhere(cacheControl)) {
    headers.set("vary", varyingByCookie(headers.get("vary")));
  }

  return headers;
};

/**
 * `response` as the edge may keep it, for `request`: the same status and
 * body (a stream stays a stream), under the two rules above.
 */
export const forTheEdge = (request: Request, response: Response): Response =>
  new Response(response.body, {
    headers: edgeHeaders(request, response),
    status: response.status,
    statusText: response.statusText,
  });

/** A Worker's `fetch`, as TanStack Start's server entry gives it. */
interface Entry<Rest extends readonly unknown[]> {
  readonly fetch: (
    request: Request,
    ...rest: Rest
  ) => Promise<Response> | Response;
}

/** The Worker's `fetch` once every answer passes through `forTheEdge`. */
interface EdgeEntry<Rest extends readonly unknown[]> {
  readonly fetch: (request: Request, ...rest: Rest) => Promise<Response>;
}

/**
 * `entry` with every answer it gives passed through `forTheEdge`; its other
 * arguments (the Worker's env and context) go on to it untouched.
 */
export const edgeEntry = <Rest extends readonly unknown[]>(
  entry: Entry<Rest>
): EdgeEntry<Rest> => ({
  fetch: (request, ...rest) =>
    Effect.runPromise(
      Effect.map(
        Effect.promise(() => Promise.resolve(entry.fetch(request, ...rest))),
        (response) => forTheEdge(request, response)
      )
    ),
});
