import { Effect } from "effect";
import { delay, sleep } from "effect/Effect";

export const waits = Effect.sleep("1 second");
export const later = Effect.succeed(1).pipe(Effect.delay("1 second"));
export const bracketed = Effect["sleep"]("1 second");
export const named = [delay, sleep];
