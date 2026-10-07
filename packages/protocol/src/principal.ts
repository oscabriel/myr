import { Context, Schema } from "effect";
import { RpcMiddleware } from "effect/rpc";

import { Handle } from "./ids.ts";

/** Who is calling: the person a verified credential names. */
export const Principal = Schema.Struct({ handle: Handle });

export type Principal = typeof Principal.Type;

/** The caller of the contract being handled. */
export class CurrentPrincipal extends Context.Service<
  CurrentPrincipal,
  Principal
>()("protocol/CurrentPrincipal") {}

/** The call carried no credential, or one the platform does not know. */
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  {}
) {}

/**
 * Every contract runs as someone. A host's server side turns the call's
 * credential into the `CurrentPrincipal`; a client side attaches it.
 */
export class Authenticated extends RpcMiddleware.Service<
  Authenticated,
  { provides: CurrentPrincipal }
>()("protocol/Authenticated", { error: Unauthenticated }) {}
