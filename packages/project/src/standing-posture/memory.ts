import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Layer, Ref } from "effect";

import { StandingPostures } from "../standing-posture.ts";
import type {
  StandingEntry,
  StandingPosturesApi,
} from "../standing-posture.ts";

export const StandingPosturesMemory = Layer.effect(
  StandingPostures,
  Effect.gen(function* () {
    const kept = yield* Ref.make<ReadonlyMap<ProjectName, StandingEntry>>(
      new Map()
    );

    const store: StandingPosturesApi = {
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
