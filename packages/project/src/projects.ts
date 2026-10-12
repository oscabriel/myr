import type { CreditSummary } from "@repo/protocol/domain/record";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { Anonymous } from "@repo/protocol/principal";
import type { ProjectExists, UnknownProject } from "@repo/protocol/refusal";
import { Array, Context, Effect, Order } from "effect";

import type { ProjectApi } from "./project.ts";

export class Projects extends Context.Service<
  Projects,
  {
    readonly get: (
      project: ProjectName
    ) => Effect.Effect<ProjectApi, UnknownProject>;
    readonly create: (
      project: ProjectName
    ) => Effect.Effect<ProjectApi, ProjectExists>;
  }
>()("project/Projects") {}

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
