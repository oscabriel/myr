import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** An HTTP request that got no response: the network, DNS or TLS failed. */
export class FetchFailed extends Schema.TaggedError<FetchFailed>()(
  "FetchFailed",
  { reason: Schema.String, url: Schema.String }
) {}

/**
 * The one way a package makes an HTTP request, so none calls the global
 * `fetch`. A response of any status is a success; only a request that got no
 * response fails. The Worker's adapter wraps its `fetch`; tests serve an
 * in-process handler with `Fetch.of`.
 */
export class Fetch extends Context.Service<
  Fetch,
  {
    readonly fetch: (request: Request) => Effect.Effect<Response, FetchFailed>;
  }
>()("artifacts/Fetch") {}
