import { Context, Schema } from "effect";
import { RpcMiddleware } from "effect/rpc";

import { Handle } from "./ids.ts";

export const Person = Schema.TaggedStruct("Person", { handle: Handle });

export type Person = typeof Person.Type;

export const Anonymous = Schema.TaggedStruct("Anonymous", {});

export type Anonymous = typeof Anonymous.Type;

export const Principal = Schema.Union([Person, Anonymous]).pipe(
  Schema.toTaggedUnion("_tag")
);

export type Principal = typeof Principal.Type;

export class CurrentPrincipal extends Context.Service<
  CurrentPrincipal,
  Principal
>()("protocol/CurrentPrincipal") {}

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  {}
) {}

export class Authenticated extends RpcMiddleware.Service<
  Authenticated,
  { provides: CurrentPrincipal }
>()("protocol/Authenticated", { error: Unauthenticated }) {}
