// Keyed by (project, seq), not row id: every project's outbox names its rows `projected:<seq>`, so ids collide across projects.
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { Projection, ProjectedEvent } from "../projection.ts";

const decodeProjected = Schema.decodeUnknownEffect(ProjectedEvent);

export class ProjectedRows extends Context.Service<
  ProjectedRows,
  { readonly events: Effect.Effect<readonly ProjectedEvent[]> }
>()("project/ProjectedRows") {}

export const ProjectionMemory: Layer.Layer<Projection | ProjectedRows> =
  Layer.effectContext(
    Effect.gen(function* () {
      const taken = yield* Ref.make<ReadonlyMap<string, ProjectedEvent>>(
        new Map()
      );

      return Context.make(Projection, {
        apply: (rows) =>
          Effect.flatMap(
            Effect.forEach(rows, (row) =>
              Effect.orDie(decodeProjected(row.body))
            ),
            (projected) =>
              Ref.update(taken, (kept) => {
                const next = new Map(kept);

                for (const one of projected) {
                  const key = `${one.project}:${one.event.seq}`;

                  next.set(key, next.get(key) ?? one);
                }

                return next;
              })
          ),
      }).pipe(
        Context.add(ProjectedRows, {
          events: Effect.map(Ref.get(taken), (kept) => [...kept.values()]),
        })
      );
    })
  );
