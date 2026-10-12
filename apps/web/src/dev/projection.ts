// Keyed by project and event number: `@repo/project`'s memory projection keys rows by outbox id,
// which two projects share.
import { Projection, ProjectedEvent } from "@repo/project/projection";
import { Context, Effect, Layer, Ref, Schema } from "effect";

const decodeProjected = Schema.decodeUnknownEffect(
  Schema.toCodecJson(ProjectedEvent)
);

export class DevProjected extends Context.Service<
  DevProjected,
  { readonly events: Effect.Effect<readonly ProjectedEvent[]> }
>()("web/dev/DevProjected") {}

export const DevProjection: Layer.Layer<Projection | DevProjected> =
  Layer.effectContext(
    Effect.gen(function* () {
      const taken = yield* Ref.make<ReadonlyMap<string, ProjectedEvent>>(
        new Map()
      );

      const projection = Projection.of({
        apply: (rows) =>
          Effect.flatMap(
            Effect.forEach(rows, (row) =>
              Effect.orDie(decodeProjected(row.body))
            ),
            (events) =>
              Ref.update(taken, (kept) => {
                const next = new Map(kept);

                for (const projected of events) {
                  const key = `${projected.project}:${projected.event.seq}`;

                  next.set(key, next.get(key) ?? projected);
                }

                return next;
              })
          ),
      });

      return Context.make(Projection, projection).pipe(
        Context.add(DevProjected, {
          events: Effect.map(Ref.get(taken), (kept) => [...kept.values()]),
        })
      );
    })
  );
