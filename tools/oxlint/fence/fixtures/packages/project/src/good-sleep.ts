import { Clock, Effect } from "effect";

// A lifecycle hands back its deadline as data; the Durable Object sets the
// alarm. Reading the clock is fine: waiting on it is not.
export const deadline = Effect.map(Clock.currentTimeMillis, (now) => ({
  alarmAt: now + 60_000,
}));

const Sleepy = { sleep: () => "a property of something else" };

export const other = Sleepy.sleep();
