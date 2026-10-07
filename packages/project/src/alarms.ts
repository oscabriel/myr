/**
 * The `Alarms` port: how a project asks to be woken. A Durable Object holds
 * one alarm, so `set` replaces whatever was set before; the project service
 * decides when (the earliest claim deadline, outbox retry or answer retry
 * still pending) and calls `onAlarm` when it fires. Adapters: `/memory`
 * here, the DO's storage alarm in `apps/platform` (W3 302).
 */
import { Context } from "effect";
import type { DateTime, Effect } from "effect";

export class Alarms extends Context.Service<
  Alarms,
  {
    /** Wake the project at `at`, in place of any alarm set before. */
    readonly set: (at: DateTime.Utc) => Effect.Effect<void>;
  }
>()("project/Alarms") {}
