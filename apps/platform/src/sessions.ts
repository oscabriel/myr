import type { Person } from "@repo/protocol/principal";
import { Context } from "effect";
import type { Effect, Option } from "effect";

/**
 * Turns a bearer credential into the person it names, if it names anyone.
 * The platform has one: every source of tokens (sign-in, the operator,
 * `SESSION_TOKENS`) is a `Sessions` of its own, joined by
 * `sessions/first-of.ts`. A credential never names anyone at all: calling
 * as anyone is having none.
 */
export class Sessions extends Context.Service<
  Sessions,
  {
    readonly verify: (token: string) => Effect.Effect<Option.Option<Person>>;
  }
>()("platform/Sessions") {}
