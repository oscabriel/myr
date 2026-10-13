import { D1Client } from "@effect/sql-d1";
import type { Fetch } from "@repo/artifacts/fetch";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostBinding } from "@repo/artifacts/repo-host/binding";
import type { CheckRunner } from "@repo/checks/check-runner";
import type { EvidenceStore } from "@repo/checks/evidence-store";
import { EvidenceStoreR2 } from "@repo/checks/evidence-store/r2";
import type { Drafter } from "@repo/drafting/drafter";
import { DrafterWorkersAi } from "@repo/drafting/drafter/binding";
import { DraftModel } from "@repo/drafting/run";
import type { Upstream } from "@repo/git/upstream";
import { UpstreamRepoHost } from "@repo/git/upstream/repo-host";
import { CodeStoreR2 } from "@repo/project/code-store/binding";
import { CodeCacheLive } from "@repo/project/code/cache";
import { ProjectDescriptionsMemory } from "@repo/project/description/memory";
import type { FrontPage } from "@repo/project/front-page";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import type { Lander } from "@repo/project/lander";
import { LanderIsogit } from "@repo/project/lander/isogit";
import { MetricsBinding } from "@repo/project/metrics/binding";
import { FinishersFromChecks } from "@repo/project/project";
import type { Projection } from "@repo/project/projection";
import { ProjectDescriptionsD1 } from "@repo/project/projection-d1/descriptions";
import { FrontPageD1 } from "@repo/project/projection-d1/front-page";
import { StandingPosturesD1 } from "@repo/project/projection-d1/postures";
import { ProjectionD1 } from "@repo/project/projection-d1/projection";
import { ProjectionMemory } from "@repo/project/projection/memory";
import type { Projects } from "@repo/project/projects";
import type { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { RulesEvaluatorWorker } from "@repo/rules/rules-evaluator/worker";
import { Telemetry } from "@repo/telemetry/telemetry";
import { tracing } from "cloudflare:workers";
import { Layer, Option, Redacted } from "effect";

import { CheckRunnerSandbox } from "./adapters/check-runner-sandbox.ts";
import { DoProjects } from "./adapters/do-projects.ts";
import { DraftRunsWorkflow } from "./adapters/draft-runs-workflow.ts";
import { WorkerFetch } from "./adapters/fetch.ts";
import { LanderSandbox } from "./adapters/lander-sandbox.ts";
import { WorkerRateLimits } from "./adapters/rate-limits.ts";
import * as cartridges from "./cartridges.ts";
import type { Cartridge } from "./cartridges.ts";
import type { PlatformConfig } from "./platform.ts";
import type { RateLimits } from "./rate-limits.ts";
import { ProjectSockets } from "./watch.ts";

// Sized to stay well inside the isolate's 128 MB; what an object id names never
// changes, and each Artifacts read is billed.
const CODE_READS_KEPT = { heavy: 40, light: 2000 };

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

const plugIn = (
  config: PlatformConfig,
  ports: Layer.Layer<WorkerPorts>,
  plugged: readonly Cartridge[]
): Layer.Layer<WorkerPorts> =>
  Layer.mergeAll(
    ports,
    ...plugged.map((cartridge) => cartridge(config).pipe(Layer.provide(ports)))
  );

const memoryFrontPage = Layer.mergeAll(
  FrontPageMemory.layer({ credits: [], entries: [], projects: [] }),
  ProjectionMemory,
  ProjectDescriptionsMemory
);

const corePorts = (config: PlatformConfig): Layer.Layer<WorkerPorts> =>
  Layer.mergeAll(
    memoryFrontPage,
    // The D1 cartridge: delete this entry and the platform falls back to the memory
    // front page.
    Layer.mergeAll(
      FrontPageD1,
      ProjectionD1,
      StandingPosturesD1,
      ProjectDescriptionsD1
    ).pipe(
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
    Layer.succeed(ProjectSockets, Option.some(config.PROJECT)),
    WorkerRateLimits({
      claim: config.CLAIM_LIMIT,
      draft: config.DRAFT_LIMIT,
      proposal: config.PROPOSAL_LIMIT,
    }),
    EvidenceStoreR2(config.EVIDENCE),
    CodeCacheLive(CODE_READS_KEPT.light, CODE_READS_KEPT.heavy),
    CodeStoreR2(config.CODE_CACHE),
    MetricsBinding(config.METRICS),
    // Without this entry a draft proposal starts no run, and stays drafting.
    DraftRunsWorkflow(config.ANSWER)
  ).pipe(
    Layer.provideMerge(RepoHostBinding.layer(config.ARTIFACTS)),
    Layer.provideMerge(WorkerFetch)
  );

export const workerPorts = (config: PlatformConfig): Layer.Layer<WorkerPorts> =>
  plugIn(config, corePorts(config), Object.values(cartridges));

// Every secret the env holds, a session table's tokens each on its own.
const secretsOf = (config: PlatformConfig): readonly Redacted.Redacted[] => [
  config.COOKIE_KEY,
  config.MASTER_KEY,
  config.OPERATOR_TOKEN,
  config.PASSWORD_PEPPER,
  ...Option.toArray(Option.fromUndefinedOr(config.GOOGLE_CLIENT_SECRET)),
  ...Option.match(Option.fromUndefinedOr(config.SESSION_TOKENS), {
    onNone: () => [],
    onSome: (table) =>
      Object.keys(Redacted.value(table)).map((token) => Redacted.make(token)),
  }),
];

// The JSON logger, defect reporting and spans of every runtime the Worker
// starts: its routers, each Project DO and each Workflow instance. A defect
// is kept by its name and frames alone: the visibility cartridge runs here,
// and a defect's text may name a layer's repo or quote a sealed path.
export const telemetryOf = (config: PlatformConfig): Layer.Layer<never> =>
  Telemetry({ defects: "name", secrets: secretsOf(config), tracing });

export const draftPorts = (config: PlatformConfig): Layer.Layer<Drafter> =>
  Layer.merge(
    DrafterWorkersAi(config.AI, config.DRAFT_MODEL),
    Layer.succeed(DraftModel, config.DRAFT_MODEL)
  );
