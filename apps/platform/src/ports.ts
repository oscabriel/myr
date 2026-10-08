/**
 * The ports the Worker, the Project Durable Object and the Workflows run
 * on, each built once from the decoded env over the binding it needs
 * (principle 6: one job-named port per beta dependency). The Worker's
 * surfaces, each Project DO (`project-do.ts`) and both Workflows
 * (`workflows/answer.ts`, `workflows/on-push.ts`) take them from here, so
 * one stage's env decides every adapter in one place.
 *
 * Building them touches no binding: each adapter reads its binding only when
 * it is called, and whatever it keeps per isolate (the upstream's token
 * cache, the Project DO stubs it found) lives in the layer, never in the
 * module. `Alarms` and `AnswerRuns` are bound per project inside its Durable
 * Object; `Sessions` is the surfaces' (`platform.ts`).
 *
 * Cartridges plug in over these ports (`plugIn`), one marked line each in
 * `cartridges.ts`. The visibility cartridge fills `LayerGate` for
 * the gateway, and `ProjectVisibility` and `ProjectEnv` for each Project
 * DO's service; without it they answer their defaults, a platform without
 * typed visibility. Every host takes its ports from here, so the one line
 * serves them all.
 */
import { D1Client } from "@effect/sql-d1";
import type { Fetch } from "@repo/artifacts/fetch";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostBinding } from "@repo/artifacts/repo-host/binding";
import type { CheckRunner } from "@repo/checks/check-runner";
import type { EvidenceStore } from "@repo/checks/evidence-store";
import { EvidenceStoreR2 } from "@repo/checks/evidence-store/r2";
import type { Upstream } from "@repo/git/upstream";
import { UpstreamRepoHost } from "@repo/git/upstream/repo-host";
import type { FrontPage } from "@repo/project/front-page";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import type { Lander } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { FinishersFromChecks } from "@repo/project/project";
import type { Projection } from "@repo/project/projection";
import { FrontPageD1 } from "@repo/project/projection-d1/front-page";
import { ProjectionD1 } from "@repo/project/projection-d1/projection";
import { ProjectionMemory } from "@repo/project/projection/memory";
import type { Projects } from "@repo/project/projects";
import type { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { RulesEvaluatorWorker } from "@repo/rules/rules-evaluator/worker";
import { Layer, Option } from "effect";

import { CheckRunnerSandbox } from "./adapters/check-runner-sandbox.ts";
import { DoProjects } from "./adapters/do-projects.ts";
import { WorkerFetch } from "./adapters/fetch.ts";
import { LanderSandbox } from "./adapters/lander-sandbox.ts";
import { WorkerRateLimits } from "./adapters/rate-limits.ts";
import * as cartridges from "./cartridges.ts";
import type { Cartridge } from "./cartridges.ts";
import type { PlatformConfig } from "./platform.ts";
import type { RateLimits } from "./rate-limits.ts";
import { ProjectSockets } from "./watch.ts";

/** What the Worker's code runs on, besides sessions and the contracts' handlers. */
export type WorkerPorts =
  | CheckRunner
  | EvidenceStore
  | Fetch
  | FrontPage
  | Lander
  | Projection
  | Projects
  | RateLimits
  | RepoHost
  | RulesEvaluator
  | Upstream;

/**
 * Every cartridge `cartridges.ts` names, merged over `ports`. Deleting a
 * cartridge's line there unplugs it: the ports it filled answer their
 * defaults again.
 */
const plugIn = (
  config: PlatformConfig,
  ports: Layer.Layer<WorkerPorts>,
  plugged: readonly Cartridge[]
): Layer.Layer<WorkerPorts> =>
  Layer.mergeAll(
    ports,
    ...plugged.map((cartridge) => cartridge(config).pipe(Layer.provide(ports)))
  );

/**
 * The front page with no database behind it: empty, beside a projection
 * nobody reads. What the platform falls back to without the D1 cartridge.
 */
const memoryFrontPage = Layer.merge(
  FrontPageMemory.layer({ credits: [], entries: [], projects: [] }),
  ProjectionMemory
);

/**
 * The ports for one stage's env, before any cartridge: Artifacts through
 * its binding, git's upstream and every repo read over it, each project's
 * Durable Object, the sandbox's Checker, the Lander `LANDER_ADAPTER` names,
 * config folders evaluated in the Worker Loader, the front
 * page in D1, the rate limits, lane logs in the `EVIDENCE` bucket,
 * and the `PROJECT` namespace again for `watch`'s relay of each project's
 * socket.
 */
const corePorts = (config: PlatformConfig): Layer.Layer<WorkerPorts> =>
  Layer.mergeAll(
    memoryFrontPage,
    // The D1 cartridge: the front page and its projection in
    // `FRONT_PAGE`, in place of the memory one above. Delete this entry
    // (and its imports) and the platform falls back to the memory front page.
    Layer.merge(FrontPageD1, ProjectionD1).pipe(
      Layer.provide(D1Client.layer({ db: config.FRONT_PAGE })),
      Layer.orDie
    ),
    UpstreamRepoHost,
    CheckRunnerSandbox(config.SANDBOX),
    config.LANDER_ADAPTER === "isogit"
      ? LanderIsogit
      : LanderSandbox(config.SANDBOX),
    RulesEvaluatorWorker(config.LOADER).pipe(
      Layer.provide(FinishersFromChecks)
    ),
    DoProjects(config.PROJECT),
    // `watch` relays each project's DO socket; without this
    // entry it follows each project's event log instead.
    Layer.succeed(ProjectSockets, Option.some(config.PROJECT)),
    WorkerRateLimits({
      claim: config.CLAIM_LIMIT,
      proposal: config.PROPOSAL_LIMIT,
    }),
    EvidenceStoreR2(config.EVIDENCE)
  ).pipe(
    Layer.provideMerge(RepoHostBinding.layer(config.ARTIFACTS)),
    Layer.provideMerge(WorkerFetch)
  );

/** The ports for one stage's env, with every cartridge the platform plugs in. */
export const workerPorts = (config: PlatformConfig): Layer.Layer<WorkerPorts> =>
  plugIn(config, corePorts(config), Object.values(cartridges));
