/**
 * `Alarms` in memory, for tests: like a Durable Object it holds one alarm,
 * the one set last, which the service always computes as its earliest
 * pending deadline. Nothing fires by itself: a test reads `ScheduledAlarm`,
 * moves the TestClock there, and calls the project's `onAlarm`.
 */
import { Context, Effect, Layer, Option, Ref } from "effect";
import type { DateTime } from "effect";

import { Alarms } from "../alarms.ts";

/** When the memory alarm is set to go off, if it is set. */
export class ScheduledAlarm extends Context.Service<
  ScheduledAlarm,
  { readonly at: Effect.Effect<Option.Option<DateTime.Utc>> }
>()("project/ScheduledAlarm") {}

/** A fresh alarm each time the layer is built, and the reading of it. */
export const AlarmsMemory: Layer.Layer<Alarms | ScheduledAlarm> =
  Layer.effectContext(
    Effect.gen(function* () {
      const alarm = yield* Ref.make(Option.none<DateTime.Utc>());

      return Context.make(Alarms, {
        set: (at) => Ref.set(alarm, Option.some(at)),
      }).pipe(Context.add(ScheduledAlarm, { at: Ref.get(alarm) }));
    })
  );
