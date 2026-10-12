import type { ProjectName } from "@repo/protocol/ids";
import { ProjectExists, UnknownProject } from "@repo/protocol/refusal";
import { Context, Effect, Layer, Option, SynchronizedRef } from "effect";

import type { ProjectStore } from "../project-store.ts";
import { ProjectStoreMemory } from "../project-store/memory.ts";
import { projectService } from "../project.ts";
import type { ProjectApi, ProjectPorts } from "../project.ts";
import { Projects } from "../projects.ts";

export const ProjectsMemory: Layer.Layer<
  Projects,
  never,
  Exclude<ProjectPorts, ProjectStore>
> = Layer.effect(
  Projects,
  Effect.gen(function* () {
    const ports = yield* Effect.context<Exclude<ProjectPorts, ProjectStore>>();
    const scope = yield* Effect.scope;

    const made = yield* SynchronizedRef.make<
      ReadonlyMap<ProjectName, ProjectApi>
    >(new Map());

    const build = (project: ProjectName) =>
      Effect.gen(function* () {
        // Fresh, or the build would reuse a store an enclosing layer made.
        const store = yield* Layer.buildWithScope(
          Layer.fresh(ProjectStoreMemory),
          scope
        );

        return yield* projectService(project).pipe(
          Effect.provideContext(Context.merge(ports, store))
        );
      });

    return Projects.of({
      create: (project) =>
        SynchronizedRef.modifyEffect(made, (projects) =>
          projects.has(project)
            ? Effect.fail(new ProjectExists({ project }))
            : Effect.map(
                build(project),
                (api) => [api, new Map(projects).set(project, api)] as const
              )
        ),
      get: (project) =>
        Effect.flatMap(SynchronizedRef.get(made), (projects) =>
          Effect.fromOption(Option.fromUndefinedOr(projects.get(project))).pipe(
            Effect.mapError(() => new UnknownProject({ project }))
          )
        ),
    });
  })
);
