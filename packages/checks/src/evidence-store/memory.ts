import { Context, Effect, Layer, Option, Ref } from "effect";

import { EvidenceStore, logRefOf } from "../evidence-store.ts";
import type { LaneLog } from "../evidence-store.ts";

export class EvidenceKept extends Context.Service<
  EvidenceKept,
  { readonly puts: Effect.Effect<readonly LaneLog[]> }
>()("checks/EvidenceKept") {}

export const EvidenceStoreMemory: Layer.Layer<EvidenceStore | EvidenceKept> =
  Layer.effectContext(
    Effect.gen(function* () {
      const puts = yield* Ref.make<readonly LaneLog[]>([]);

      return Context.make(EvidenceStore, {
        get: (ref) =>
          Effect.map(Ref.get(puts), (kept) =>
            Option.map(
              Option.fromUndefinedOr(
                kept.findLast((log) => logRefOf(log) === ref)
              ),
              ({ text }) => text
            )
          ),
        put: (log) =>
          Effect.as(
            Ref.update(puts, (kept) => [...kept, log]),
            logRefOf(log)
          ),
      }).pipe(Context.add(EvidenceKept, { puts: Ref.get(puts) }));
    })
  );
