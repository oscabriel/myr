/**
 * The `Fetch` port (`@repo/artifacts/fetch`) over the Worker's own `fetch`:
 * the one place the platform calls it, so every other caller goes through
 * the port and the `globalFetch` diagnostic holds everywhere else.
 */
import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { Effect, Layer } from "effect";

// @effect-diagnostics globalFetch:off -- the Worker's fetch is the one HTTP client; every caller goes through this port
const send = (request: Request) => fetch(request);

/**
 * Where a request went, as an error may say it: the origin and the path,
 * never a user name, a password or a query, so no credential travels in a
 * failure's text.
 */
const placeOf = (request: Request) => {
  const url = new URL(request.url);

  return `${url.origin}${url.pathname}`;
};

/** Why a request got no response, in words that carry no request header. */
const reasonOf = (cause: unknown) =>
  cause instanceof Error
    ? `the request got no response: ${cause.name}`
    : "the request got no response";

/**
 * Every request through the Worker's `fetch`. A response of any status is a
 * success; only a request that got none (the network, DNS or TLS failed) is
 * `FetchFailed`.
 */
export const WorkerFetch: Layer.Layer<Fetch> = Layer.succeed(
  Fetch,
  Fetch.of({
    fetch: (request) =>
      Effect.tryPromise({
        catch: (cause) =>
          new FetchFailed({ reason: reasonOf(cause), url: placeOf(request) }),
        try: () => send(request),
      }),
  })
);
