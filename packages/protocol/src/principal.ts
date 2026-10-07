import { Context, Schema } from "effect";
import { RpcMiddleware } from "effect/rpc";

import { Handle } from "./ids.ts";

/** A caller a verified credential names. */
export const Person = Schema.TaggedStruct("Person", { handle: Handle });

export type Person = typeof Person.Type;

/**
 * A caller with no credential. Only contracts anyone may call serve one: a
 * public read, such as the front page.
 */
export const Anonymous = Schema.TaggedStruct("Anonymous", {});

export type Anonymous = typeof Anonymous.Type;

/** Who is calling: a person, or anyone at all. Branch on it with `Principal.match`. */
export const Principal = Schema.Union([Person, Anonymous]).pipe(
  Schema.toTaggedUnion("_tag")
);

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
