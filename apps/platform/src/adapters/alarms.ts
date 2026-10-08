/**
 * The project service's `Alarms` port for a Project Durable Object: its
 * storage's one alarm. The service decides when (always its earliest pending
 * deadline); the adapter only sets it, in place of any set before, as a DO's
 * alarm is.
 */
import { Alarms } from "@repo/project/alarms";
import { DateTime, Effect, Layer } from "effect";

/** The part of a DO's storage that holds its alarm. */
export type AlarmStorage = Pick<DurableObjectStorage, "setAlarm">;

/** `Alarms` over `storage.setAlarm`. Storage that fails is a defect, as the store's is. */
export const DoAlarms = (storage: AlarmStorage): Layer.Layer<Alarms> =>
  Layer.succeed(
    Alarms,
    Alarms.of({
      set: (at) =>
        Effect.promise(() => storage.setAlarm(DateTime.toEpochMillis(at))),
    })
  );
