/**
 * The `Projects` port: the one way a caller reaches a project by its name.
 * Each project is one service over its own store (one Durable Object in W3,
 * 302's `DoProjects`); this port finds it, or makes a new one. `creditsFor`
 * folds a person's credits over the projects it is given.
 *
 * Adapters: `/memory` here, which keeps one memory store per project.
 */
import type { CreditSummary } from "@repo/protocol/domain/record";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { Anonymous } from "@repo/protocol/principal";
import type { ProjectExists, UnknownProject } from "@repo/protocol/refusal";
import { Array, Context, Effect, Order } from "effect";

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

/**
 * A person's credits across `projects`, by project, area and role: each
 * project's own count (`credits`), joined in project order, as the public
 * `credits` contract answers them. A project not made is skipped. The port
 * finds projects by name and lists none, so the caller names them: the
 * platform's handler passes the projection's list (W3).
 */
export const creditsFor = (
  handle: Handle,
  projects: readonly ProjectName[]
): Effect.Effect<readonly CreditSummary[], never, Projects> =>
  Effect.gen(function* () {
    const found = yield* Projects;

    const each = yield* Effect.forEach(
      Array.sort(Array.dedupe(projects), Order.String),
      (project) =>
        found.get(project).pipe(
          Effect.flatMap((api) => api.credits(Anonymous.make({}), handle)),
          Effect.map(({ credits }) => credits),
          Effect.catchTag("UnknownProject", () => Effect.succeed([]))
        )
    );

    return each.flat();
  });
