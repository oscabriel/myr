// Workers Cache keys an answer by path and query alone, not by host, `Cookie` or `Authorization`.
// An answer to a request with a credential, one that sets a cookie, or one with no `Cache-Control` is kept nowhere;
// any other varies by `Cookie`, so a signed-in reader is never handed a page kept from a signed-out one.
// A page the edge keeps is served stale for a day while it is read again, so a page seldom visited still answers
// at the edge's speed; the browser keeps its own `Cache-Control`, and a page's events bring it up to date once drawn.
import { Effect } from "effect";

export const KEPT_NOWHERE = "private, no-store";

const EDGE_OVERRIDES = ["cdn-cache-control", "cloudflare-cdn-cache-control"];

const EDGE_ONLY = "cloudflare-cdn-cache-control";

export const EDGE_STALE_SECONDS = 86_400;

const directivesOf = (cacheControl: string) =>
  cacheControl
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter((directive) => directive !== "");

const speaksForSomeone = (request: Request) =>
  request.headers.has("cookie") || request.headers.has("authorization");

// A field-naming directive (`private="set-cookie"`) lets the cache store the answer with that field stripped.
const unsafeFor = (cacheControl: string | null) =>
  cacheControl === null ||
  directivesOf(cacheControl).some(
    (directive) =>
      directive.startsWith("private=") || directive.startsWith("no-cache=")
  );

const keptNowhere = (cacheControl: string) =>
  directivesOf(cacheControl).some(
    (directive) => directive === "private" || directive === "no-store"
  );

// Only a found page with an age of its own: a miss may be answered once it is made, and an immutable answer is never stale.
const staleLonger = (cacheControl: string, status: number) => {
  const directives = directivesOf(cacheControl);

  return status !== 200 ||
    directives.includes("immutable") ||
    !directives.some((directive) => directive.startsWith("max-age="))
    ? undefined
    : [
        ...directives.filter(
          (directive) => !directive.startsWith("stale-while-revalidate=")
        ),
        `stale-while-revalidate=${EDGE_STALE_SECONDS}`,
      ].join(", ");
};

const varyingByCookie = (vary: string | null) => {
  const names = (vary ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

  return names.some((name) => name.toLowerCase() === "cookie")
    ? names.join(", ")
    : [...names, "Cookie"].join(", ");
};

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

    const atTheEdge = staleLonger(cacheControl, response.status);

    if (atTheEdge !== undefined) {
      headers.set(EDGE_ONLY, atTheEdge);
    }
  }

  return headers;
};

export const forTheEdge = (request: Request, response: Response): Response =>
  new Response(response.body, {
    headers: edgeHeaders(request, response),
    status: response.status,
    statusText: response.statusText,
  });

interface Entry<Rest extends readonly unknown[]> {
  readonly fetch: (
    request: Request,
    ...rest: Rest
  ) => Promise<Response> | Response;
}

interface EdgeEntry<Rest extends readonly unknown[]> {
  readonly fetch: (request: Request, ...rest: Rest) => Promise<Response>;
}

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
