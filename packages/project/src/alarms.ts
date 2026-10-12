import { Context } from "effect";
import type { DateTime, Effect } from "effect";

export class Alarms extends Context.Service<
  Alarms,
  {
    readonly set: (at: DateTime.Utc) => Effect.Effect<void>;
  }
>()("project/Alarms") {}
