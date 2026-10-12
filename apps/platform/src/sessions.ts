import type { Person } from "@repo/protocol/principal";
import { Context } from "effect";
import type { Effect, Option } from "effect";

export class Sessions extends Context.Service<
  Sessions,
  {
    readonly verify: (token: string) => Effect.Effect<Option.Option<Person>>;
  }
>()("platform/Sessions") {}
