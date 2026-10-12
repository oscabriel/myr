import type { RequestId } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { enqueue, LandingQueue, next as admitNext, settle } from "./landing.ts";

export const emptyQueue: LandingQueue = { active: Option.none(), order: [] };

const decodeQueue = Schema.decodeUnknownEffect(LandingQueue);

const encodeQueue = Schema.encodeEffect(LandingQueue);

/** `null` until a commit first writes one. */
export const queueOf = (stored: Schema.Json): Effect.Effect<LandingQueue> =>
  stored === null
    ? Effect.succeed(emptyQueue)
    : Effect.orDie(decodeQueue(stored));

export const storedQueue = (queue: LandingQueue): Effect.Effect<Schema.Json> =>
  Effect.orDie(encodeQueue(queue));

export const holdsSlot = (queue: LandingQueue, id: RequestId): boolean =>
  Option.contains(queue.active, id);

export interface Moved {
  readonly admitted: Option.Option<RequestId>;
  readonly queue: LandingQueue;
}

export const askToLand = (queue: LandingQueue, id: RequestId): Moved => {
  const { admit, queue: moved } = admitNext(enqueue(queue, id));

  return { admitted: admit, queue: moved };
};

export const leave = (queue: LandingQueue, id: RequestId): Moved => {
  const { admit, queue: moved } = admitNext(settle(queue, id));

  return { admitted: admit, queue: moved };
};
