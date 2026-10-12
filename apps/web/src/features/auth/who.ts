import { Handle } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { Atom } from "effect/reactivity";

const Who = Schema.Struct({ handle: Schema.optionalKey(Handle) });

export const whoAtom = Atom.make(
  HttpClient.get("/auth/whoami").pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Who)),
    Effect.map(({ handle }) => Option.fromUndefinedOr(handle)),
    Effect.orElseSucceed(() => Option.none<Handle>()),
    Effect.provide(FetchHttpClient.layer)
  )
).pipe(Atom.withServerValueInitial);
