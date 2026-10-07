/**
 * `Projection` in memory, for tests: it keeps every row it was given, once
 * per row id, in the order it first took them, and reads them back as the
 * events they carry.
 */
import { Context, Effect, Layer, Ref, Schema } from "effect";

import type { OutboxRow } from "../project-store/rows.ts";
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
      const taken = yield* Ref.make<ReadonlyMap<string, OutboxRow>>(new Map());

      return Context.make(Projection, {
        apply: (rows) =>
          Ref.update(taken, (kept) => {
            const next = new Map(kept);

            for (const row of rows) {
              next.set(row.id, next.get(row.id) ?? row);
            }

            return next;
          }),
      }).pipe(
        Context.add(ProjectedRows, {
          events: Effect.flatMap(Ref.get(taken), (kept) =>
            Effect.forEach([...kept.values()], (row) =>
              Effect.orDie(decodeProjected(row.body))
            )
          ),
        })
      );
    })
  );
