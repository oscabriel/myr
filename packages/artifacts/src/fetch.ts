import { Context, Schema } from "effect";
import type { Effect } from "effect";

export class FetchFailed extends Schema.TaggedError<FetchFailed>()(
  "FetchFailed",
  { reason: Schema.String, url: Schema.String }
) {}

export class Fetch extends Context.Service<
  Fetch,
  {
    readonly fetch: (request: Request) => Effect.Effect<Response, FetchFailed>;
  }
>()("artifacts/Fetch") {}
