import type { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import type { EvidenceStore } from "@repo/checks/evidence-store";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { cannedDrafter } from "@repo/drafting/draft-runs/canned";
import { withDraftRunsInline } from "@repo/drafting/draft-runs/inline";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { ProjectDescriptionsMemory } from "@repo/project/description/memory";
import type { FrontPage } from "@repo/project/front-page";
import type { Lander } from "@repo/project/lander";
import { FinishersFromChecks } from "@repo/project/project";
import type { Projects } from "@repo/project/projects";
import { ProjectsMemory } from "@repo/project/projects/memory";
import { RulesEvaluatorJson } from "@repo/rules/rules-evaluator/json";
import { Layer } from "effect";
import type { DateTime } from "effect";

import { DevAnswerRunsLayer } from "./answer-runs.ts";
import type { DevAnswerRuns } from "./answer-runs.ts";
import { DevChecker } from "./checker.ts";
import { devClockAt, devStart } from "./clock.ts";
import type { DevClock } from "./clock.ts";
import { DevFrontPage } from "./front-page.ts";
import { DevLander } from "./lander.ts";
import { DevProjection } from "./projection.ts";

const ports = Layer.mergeAll(
  AlarmsMemory,
  DevAnswerRunsLayer,
  cannedDrafter,
  DevProjection,
  RulesEvaluatorJson.pipe(Layer.provide(FinishersFromChecks))
).pipe(
  Layer.provideMerge(Layer.mergeAll(DevChecker, DevLander)),
  Layer.provideMerge(RepoHostMemory)
);

const core = withDraftRunsInline(ProjectsMemory).pipe(
  Layer.provideMerge(ports)
);

export type DevCore = Layer.Success<typeof core> | DevClock;

export const devWorldWith = <Out, E, In extends DevCore>(
  between: Layer.Layer<Out, E, In>,
  start: DateTime.Utc = devStart
) =>
  // Descriptions kept as the platform keeps them, so a list reads each landed project once per landing.
  Layer.mergeAll(
    DevFrontPage,
    EvidenceStoreMemory,
    ProjectDescriptionsMemory
  ).pipe(
    Layer.provideMerge(between),
    Layer.provideMerge(core),
    Layer.provideMerge(devClockAt(start)),
    Layer.fresh
  );

export const devWorldAt = (
  start: DateTime.Utc
): Layer.Layer<
  | Projects
  | FrontPage
  | EvidenceStore
  | RepoHost
  | DevClock
  | Lander
  | DevAnswerRuns
> => devWorldWith(Layer.empty, start);
