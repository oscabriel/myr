import { Effect } from "effect";

// The platform is one protected resource, its origin, as
// /.well-known/oauth-protected-resource says, and its tokens serve every path
// on it. MCP's authorization has a client name its server's own URL
// (`<origin>/mcp`) as the resource, and some clients name that only when they
// trade a code or refresh, having named the origin to authorize; RFC 8707 §2
// lets the authorization server read a resource coarser than it was named, so
// any URL on this origin is read as the origin. A resource on another origin
// is left as it was sent, for the provider to refuse with `invalid_target`.
const asPlatform = (origin: string) => (resource: string) => {
  const url = URL.parse(resource);

  return url !== null &&
    url.origin === origin &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
    ? origin
    : resource;
};

const withResources = (params: URLSearchParams, origin: string) => {
  const named = new URLSearchParams(params);

  named.delete("resource");

  for (const resource of params.getAll("resource").map(asPlatform(origin))) {
    named.append("resource", resource);
  }

  return named;
};

// An authorize request's `resource`, read as the platform's where it names a URL on it.
export const authorizeNamingPlatform = (request: Request, origin: string) => {
  const url = new URL(request.url);

  if (!url.searchParams.has("resource")) {
    return request;
  }

  url.search = withResources(url.searchParams, origin).toString();

  return new Request(url, request);
};

const isForm = (request: Request) =>
  request.method === "POST" &&
  (request.headers.get("content-type") ?? "").startsWith(
    "application/x-www-form-urlencoded"
  );

// A token request's `resource`, in its form body, read the same way.
export const tokenNamingPlatform = (request: Request, origin: string) =>
  isForm(request)
    ? Effect.promise(() => request.clone().text()).pipe(
        Effect.map((body) => {
          const params = new URLSearchParams(body);

          if (!params.has("resource")) {
            return request;
          }

          const headers = new Headers(request.headers);

          headers.delete("content-length");

          return new Request(request.url, {
            body: withResources(params, origin),
            headers,
            method: request.method,
          });
        })
      )
    : Effect.succeed(request);
