/**
 * The dev world: the project service over memory adapters, every project
 * in one isolate, as `@repo/project`'s own scenario test runs it. Repos live
 * in the memory repo host and move only by real git objects (`git.ts`); the
 * Lander does the trusted Lander's work over them (`lander.ts`); the
 * Checker is scripted (`checker.ts`); rules are read from each project's
 * committed `policy.json` (`/json`); answers run in process; alarms are
 * recorded and never fire; the front page is folded from the projection's
 * rows (`front-page.ts`); lane logs are kept in memory. A proposal made
 * with a draft is drafted in process as it is made, by the memory drafter
 * scripted with the canned draft (`@repo/drafting/draft-runs/canned`),
 * and goes red first on the scripted Checker. One clock, set by the seed,
 * is the world's time (`clock.ts`).
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import type { EvidenceStore } from "@repo/checks/evidence-store";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { cannedDrafter } from "@repo/drafting/draft-runs/canned";
import { withDraftRunsInline } from "@repo/drafting/draft-runs/inline";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRunsInline } from "@repo/project/answer-runs/inline";
import type { FrontPage } from "@repo/project/front-page";
import { FinishersFromChecks } from "@repo/project/project";
import type { Projects } from "@repo/project/projects";
import { ProjectsMemory } from "@repo/project/projects/memory";
import { RulesEvaluatorJson } from "@repo/rules/rules-evaluator/json";
import { Layer } from "effect";

import { DevChecker } from "./checker.ts";
import { devClockAt, devStart } from "./clock.ts";
import type { DevClock } from "./clock.ts";
import { DevFrontPage } from "./front-page.ts";
import { DevLander } from "./lander.ts";
import { DevProjection } from "./projection.ts";

/** Every port a project needs but its store, shared by every project in the world. */
const ports = Layer.mergeAll(
  AlarmsMemory,
  AnswerRunsInline,
  cannedDrafter,
  DevProjection,
  RulesEvaluatorJson.pipe(Layer.provide(FinishersFromChecks))
).pipe(
  Layer.provideMerge(Layer.mergeAll(DevChecker, DevLander)),
  Layer.provideMerge(RepoHostMemory)
);

/**
 * A fresh, empty world: its projects, the front page over them, the lane
 * logs, the repo host the people's git pushes to, and its clock at
 * `devStart`. Built twice, it is two worlds.
 */
export const devWorld: Layer.Layer<
  Projects | FrontPage | EvidenceStore | RepoHost | DevClock
> = Layer.mergeAll(DevFrontPage, EvidenceStoreMemory).pipe(
  Layer.provideMerge(withDraftRunsInline(ProjectsMemory)),
  Layer.provideMerge(ports),
  Layer.provideMerge(devClockAt(devStart)),
  Layer.fresh
);
