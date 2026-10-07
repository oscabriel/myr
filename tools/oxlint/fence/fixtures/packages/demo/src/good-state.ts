import { Context, Effect, Layer, Ref } from "effect";

const limit = 10;

export const total = (values: readonly number[]) => {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return Math.min(sum, limit);
};

export class Requests extends Context.Service<Requests, Ref.Ref<number>>()(
  "Requests"
) {}

export const RequestsLive = Layer.effect(Requests, Ref.make(0));

export const count = Effect.flatMap(Requests.asEffect(), (requests) =>
  Ref.updateAndGet(requests, (n) => n + 1)
);
