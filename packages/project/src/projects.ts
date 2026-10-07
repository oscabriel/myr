/**
 * The `Projects` port: the one way a caller reaches a project by its name.
 * Each project is one service over its own store (one Durable Object in W3,
 * 302's `DoProjects`); this port finds it, or makes a new one.
 *
 * Adapters: `/memory` here, which keeps one memory store per project.
 */
import type { ProjectName } from "@repo/protocol/ids";
import type { ProjectExists, UnknownProject } from "@repo/protocol/refusal";
import { Context } from "effect";
import type { Effect } from "effect";

import type { ProjectApi } from "./project.ts";

export class Projects extends Context.Service<
  Projects,
  {
    /** A project made before; one never made is `UnknownProject`. */
    readonly get: (
      project: ProjectName
    ) => Effect.Effect<ProjectApi, UnknownProject>;
    /** A new, empty project, ready for `initProject`; a name taken is `ProjectExists`. */
    readonly create: (
      project: ProjectName
    ) => Effect.Effect<ProjectApi, ProjectExists>;
  }
>()("project/Projects") {}
