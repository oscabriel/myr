import { Context, Effect, Layer, Option, Ref } from "effect";
import type { DateTime } from "effect";

import { Alarms } from "../alarms.ts";

export class ScheduledAlarm extends Context.Service<
  ScheduledAlarm,
  { readonly at: Effect.Effect<Option.Option<DateTime.Utc>> }
>()("project/ScheduledAlarm") {}

export const AlarmsMemory: Layer.Layer<Alarms | ScheduledAlarm> =
  Layer.effectContext(
    Effect.gen(function* () {
      const alarm = yield* Ref.make(Option.none<DateTime.Utc>());

      return Context.make(Alarms, {
        set: (at) => Ref.set(alarm, Option.some(at)),
      }).pipe(Context.add(ScheduledAlarm, { at: Ref.get(alarm) }));
    })
  );
