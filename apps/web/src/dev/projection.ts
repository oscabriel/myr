/**
 * Where the dev world's projects send their events for the read models:
 * the `Projection` port in memory, keyed as the D1 projection keys its rows,
 * by project and event number, so one world holds every project's events
 * and a row delivered twice is kept once. (`@repo/project`'s own memory
 * projection keys rows by their outbox id, `projected:<seq>`, which two
 * projects share: it suits a test of one project, not a world of two.)
 */
import { Projection, ProjectedEvent } from "@repo/project/projection";
import { Context, Effect, Layer, Ref, Schema } from "effect";

const decodeProjected = Schema.decodeUnknownEffect(
  Schema.toCodecJson(ProjectedEvent)
);

/** Every event the world's projects have projected, in the order they first arrived. */
export class DevProjected extends Context.Service<
  DevProjected,
  { readonly events: Effect.Effect<readonly ProjectedEvent[]> }
>()("web/dev/DevProjected") {}

/** A fresh, empty projection, and the reading of it. */
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
