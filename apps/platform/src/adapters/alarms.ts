import { Alarms } from "@repo/project/alarms";
import { DateTime, Effect, Layer } from "effect";

export type AlarmStorage = Pick<DurableObjectStorage, "setAlarm">;

export const DoAlarms = (storage: AlarmStorage): Layer.Layer<Alarms> =>
  Layer.succeed(
    Alarms,
    Alarms.of({
      set: (at) =>
        Effect.promise(() => storage.setAlarm(DateTime.toEpochMillis(at))),
    })
  );
