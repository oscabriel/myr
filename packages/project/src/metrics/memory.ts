import { Context, Effect, Layer, Ref } from "effect";

import { Metrics } from "../metrics.ts";
import type { MetricPoint } from "../metrics.ts";

export class MetricsWritten extends Context.Service<
  MetricsWritten,
  { readonly points: Effect.Effect<readonly MetricPoint[]> }
>()("project/MetricsWritten") {}

/** Keeps every point in the order it was written. */
export const MetricsMemory = Layer.effectContext(
  Effect.gen(function* () {
    const written = yield* Ref.make<readonly MetricPoint[]>([]);

    return Context.make(Metrics, {
      write: (points) => Ref.update(written, (kept) => [...kept, ...points]),
    }).pipe(Context.add(MetricsWritten, { points: Ref.get(written) }));
  })
);
