/**
 * Who is signed in, as the browser learns it: the web's own `/auth/whoami`
 * (a same-origin server route that asks the platform with the session
 * cookie the page's JavaScript cannot read). It runs in the browser only:
 * on the server the slot renders as signed out, the page's first paint, and
 * the browser fills it in.
 *
 * Not a contract, so not an atom over `ContractsClient` (`src/surfaces.ts`):
 * the session is the web's, not the platform's.
 */
import { Handle } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { Atom } from "effect/reactivity";

/** `/auth/whoami`'s answer: the handle signed in, or nothing. */
const Who = Schema.Struct({ handle: Schema.optionalKey(Handle) });

/** The handle signed in in this browser, once known; signed out on the server and on any failure. */
export const whoAtom = Atom.make(
  HttpClient.get("/auth/whoami").pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Who)),
    Effect.map(({ handle }) => Option.fromUndefinedOr(handle)),
    Effect.orElseSucceed(() => Option.none<Handle>()),
    Effect.provide(FetchHttpClient.layer)
  )
).pipe(Atom.withServerValueInitial);
