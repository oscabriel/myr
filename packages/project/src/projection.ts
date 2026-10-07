/**
 * The `Projection` port: where the project's events go to feed read models
 * outside its Durable Object, such as the front page's D1 table (W3 309).
 * The settle step hands it the outbox rows whose body is a `ProjectedEvent`,
 * in the order the events were numbered; it is retried from the outbox on
 * failure, so `apply` must be idempotent by `(project, event.seq)`.
 */
import { ProjectEvent } from "@repo/protocol/domain/event";
import { ProjectName } from "@repo/protocol/ids";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { OutboxRow } from "./project-store/rows.ts";

/** An outbox row's body for the projection: one numbered event of one project. */
export const ProjectedEvent = Schema.TaggedStruct("Projected", {
  event: ProjectEvent,
  project: ProjectName,
});

export type ProjectedEvent = typeof ProjectedEvent.Type;

/** The read model refused or could not take the rows; they stay in the outbox. */
export class ProjectionFailed extends Schema.TaggedError<ProjectionFailed>()(
  "ProjectionFailed",
  { reason: Schema.String }
) {}

export class Projection extends Context.Service<
  Projection,
  {
    readonly apply: (
      rows: readonly OutboxRow[]
    ) => Effect.Effect<void, ProjectionFailed>;
  }
>()("project/Projection") {}
