import { Context, Effect, Layer, Ref } from "effect";

const limit = 10;

declare let ambient: number;

export const total = (values: readonly number[]) => {
  let sum = ambient;
  for (const value of values) {
    sum += value;
  }
  {
    var capped = Math.min(sum, limit);
  }
  return capped;
};

export class Requests extends Context.Service<Requests, Ref.Ref<number>>()(
  "Requests"
) {}

export const RequestsLive = Layer.effect(Requests, Ref.make(0));

export const count = Requests.use((requests) =>
  Ref.updateAndGet(requests, (n) => n + 1)
);

export const handle = () =>
  Effect.runPromise(count.pipe(Effect.provide(RequestsLive)));
