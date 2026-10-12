import { ProjectEvent } from "@repo/protocol/domain/event";
import { ProjectName } from "@repo/protocol/ids";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { OutboxRow } from "./project-store/rows.ts";

export const ProjectedEvent = Schema.TaggedStruct("Projected", {
  event: ProjectEvent,
  project: ProjectName,
});

export type ProjectedEvent = typeof ProjectedEvent.Type;

export class ProjectionFailed extends Schema.TaggedError<ProjectionFailed>()(
  "ProjectionFailed",
  { reason: Schema.String }
) {}

export class Projection extends Context.Service<
  Projection,
  {
    /** Retried on failure: idempotent by `(project, event.seq)`. */
    readonly apply: (
      rows: readonly OutboxRow[]
    ) => Effect.Effect<void, ProjectionFailed>;
  }
>()("project/Projection") {}
