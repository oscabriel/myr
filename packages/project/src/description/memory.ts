import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Layer, Ref } from "effect";

import { ProjectDescriptions } from "../description.ts";
import type {
  KeptDescription,
  ProjectDescriptionsApi,
} from "../description.ts";

export const ProjectDescriptionsMemory = Layer.effect(
  ProjectDescriptions,
  Effect.gen(function* () {
    const kept = yield* Ref.make<ReadonlyMap<ProjectName, KeptDescription>>(
      new Map()
    );

    const store: ProjectDescriptionsApi = {
      get: (projects) =>
        Effect.map(
          Ref.get(kept),
          (all) =>
            new Map(
              projects.flatMap((project) => {
                const entry = all.get(project);

                return entry === undefined ? [] : [[project, entry] as const];
              })
            )
        ),
      put: (entries) =>
        Ref.update(kept, (all) => new Map([...all, ...entries])),
    };

    return store;
  })
);
