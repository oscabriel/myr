/**
 * `Projection` in memory, for tests and the platform's local composition: it
 * keeps every event it was given once per `(project, event.seq)`, as the port
 * asks, in the order it first took them, and reads them back. Not once per
 * row id: every project's outbox names its rows `projected:<seq>`, so two
 * projects' rows share ids (502 found burrow's events dropped that way).
 */
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { Projection, ProjectedEvent } from "../projection.ts";

const decodeProjected = Schema.decodeUnknownEffect(ProjectedEvent);

/** What the memory projection has taken so far. */
export class ProjectedRows extends Context.Service<
  ProjectedRows,
  { readonly events: Effect.Effect<readonly ProjectedEvent[]> }
>()("project/ProjectedRows") {}

/** A fresh, empty projection each time the layer is built, and its reading. */
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
