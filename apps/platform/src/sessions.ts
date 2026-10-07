import type { Principal } from "@repo/protocol/principal";
import { Context } from "effect";
import type { Effect, Option } from "effect";

/** Turns a bearer credential into the person it names, if it names anyone. */
export class Sessions extends Context.Service<
  Sessions,
  {
    readonly verify: (token: string) => Effect.Effect<Option.Option<Principal>>;
  }
>()("platform/Sessions") {}
