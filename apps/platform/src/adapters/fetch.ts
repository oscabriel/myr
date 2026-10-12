import { Fetch, FetchFailed } from "@repo/artifacts/fetch";
import { Effect, Layer } from "effect";

// @effect-diagnostics globalFetch:off -- the Worker's fetch is the one HTTP client; every caller goes through this port
const send = (request: Request) => fetch(request);

// Origin and path only, so no credential travels in a failure's text.
const placeOf = (request: Request) => {
  const url = new URL(request.url);

  return `${url.origin}${url.pathname}`;
};

const reasonOf = (cause: unknown) =>
  cause instanceof Error
    ? `the request got no response: ${cause.name}`
    : "the request got no response";

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
