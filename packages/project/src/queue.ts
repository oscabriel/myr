/**
 * The project's serial landing queue, over the landing lifecycle's
 * `LandingQueue` value: answers are checked side by side, but land on main
 * one at a time. A request asks for the slot when its lifecycle reaches
 * `Landing`, lands only while it holds it, and leaves when it is no longer
 * landing (landed, refused, or sent back to merge by a moved main); the
 * next in line is admitted then.
 */
import type { RequestId } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { enqueue, LandingQueue, next as admitNext, settle } from "./landing.ts";

/** No request waiting, none landing. */
export const emptyQueue: LandingQueue = { active: Option.none(), order: [] };

const decodeQueue = Schema.decodeUnknownEffect(LandingQueue);

const encodeQueue = Schema.encodeEffect(LandingQueue);

/** The queue as the store held it: `null` until a commit first writes one. */
export const queueOf = (stored: Schema.Json): Effect.Effect<LandingQueue> =>
  stored === null
    ? Effect.succeed(emptyQueue)
    : Effect.orDie(decodeQueue(stored));

/** The queue as the store keeps it. */
export const storedQueue = (queue: LandingQueue): Effect.Effect<Schema.Json> =>
  Effect.orDie(encodeQueue(queue));

/** Whether `id` holds the landing slot. */
export const holdsSlot = (queue: LandingQueue, id: RequestId): boolean =>
  Option.contains(queue.active, id);

/** A move of the queue, and the request it admitted to the slot, if any. */
export interface Moved {
  readonly admitted: Option.Option<RequestId>;
  readonly queue: LandingQueue;
}

/**
 * `id` asks for the slot: it joins the back of the line (or keeps its
 * place), and the front of the line is admitted if the slot is free.
 */
export const askToLand = (queue: LandingQueue, id: RequestId): Moved => {
  const { admit, queue: moved } = admitNext(enqueue(queue, id));

  return { admitted: admit, queue: moved };
};

/** `id` leaves the line or the slot, and the next in line is admitted if the slot is free. */
export const leave = (queue: LandingQueue, id: RequestId): Moved => {
  const { admit, queue: moved } = admitNext(settle(queue, id));

  return { admitted: admit, queue: moved };
};
