/**
 * The ports the Worker, the Project Durable Object and the Workflows run
 * on, built from the decoded env. Until W3 317 composes the real adapters
 * (the Artifacts binding, the sandbox, D1, the Loader, the Project DO), each
 * port is a stub whose every call dies with `NotWired`: a call made too soon
 * is a visible defect, never a silent success. `EvidenceStore` is already
 * real: the memory store, until W4 418 adds R2.
 *
 * `Alarms` and `AnswerRuns` are bound per project inside its Durable Object
 * (302); `RateLimits` joins when 312 makes its port.
 */
import { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { CheckRunner } from "@repo/checks/check-runner";
import type { EvidenceStore } from "@repo/checks/evidence-store";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { Upstream } from "@repo/git/upstream";
import { FrontPage } from "@repo/project/front-page";
import { Lander } from "@repo/project/lander";
import { Projection } from "@repo/project/projection";
import { Projects } from "@repo/project/projects";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { Data, Effect, Layer } from "effect";

import type { PlatformConfig } from "./platform.ts";

/** A port was called before W3 317 wired its adapter. */
export class NotWired extends Data.TaggedError("NotWired")<{
  readonly port: string;
}> {}

/** A method of `port` that dies with `NotWired`, whatever it is asked. */
const notWired = (port: string) => () => Effect.die(new NotWired({ port }));

/** Every port, unwired: building them touches nothing; calling one dies. */
export const Unwired = {
  CheckRunner: Layer.succeed(
    CheckRunner,
    CheckRunner.of({ run: notWired("CheckRunner") })
  ),
  Fetch: Layer.succeed(Fetch, Fetch.of({ fetch: notWired("Fetch") })),
  FrontPage: Layer.succeed(
    FrontPage,
    FrontPage.of({
      credits: notWired("FrontPage"),
      entries: notWired("FrontPage"),
      projects: notWired("FrontPage"),
    })
  ),
  Lander: Layer.succeed(
    Lander,
    Lander.of({
      bundleRules: notWired("Lander"),
      compose: notWired("Lander"),
      land: notWired("Lander"),
      merge: notWired("Lander"),
    })
  ),
  Projection: Layer.succeed(
    Projection,
    Projection.of({ apply: notWired("Projection") })
  ),
  Projects: Layer.succeed(
    Projects,
    Projects.of({ create: notWired("Projects"), get: notWired("Projects") })
  ),
  RepoHost: Layer.succeed(
    RepoHost,
    RepoHost.of({
      create: notWired("RepoHost"),
      fork: notWired("RepoHost"),
      importFrom: notWired("RepoHost"),
      log: notWired("RepoHost"),
      mintToken: notWired("RepoHost"),
      push: notWired("RepoHost"),
      readBlob: notWired("RepoHost"),
      readCommit: notWired("RepoHost"),
      readFile: notWired("RepoHost"),
      readTree: notWired("RepoHost"),
      refs: notWired("RepoHost"),
      remote: notWired("RepoHost"),
      remove: notWired("RepoHost"),
      revokeToken: notWired("RepoHost"),
    })
  ),
  RulesEvaluator: Layer.succeed(
    RulesEvaluator,
    RulesEvaluator.of({
      call: notWired("RulesEvaluator"),
      evaluate: notWired("RulesEvaluator"),
    })
  ),
  Upstream: Layer.succeed(
    Upstream,
    Upstream.of({ exchange: notWired("Upstream") })
  ),
};

/** What the Worker's code runs on, besides sessions and the contracts' handlers. */
export type WorkerPorts =
  | CheckRunner
  | EvidenceStore
  | Fetch
  | FrontPage
  | Lander
  | Projection
  | Projects
  | RepoHost
  | RulesEvaluator
  | Upstream;

/**
 * The ports for one stage's env. Today every one but `EvidenceStore` is
 * unwired; 317 builds each from `config` (its bindings and
 * `LANDER_ADAPTER`).
 */
export const workerPorts = (
  _config: PlatformConfig
): Layer.Layer<WorkerPorts> =>
  Layer.mergeAll(
    Unwired.CheckRunner,
    EvidenceStoreMemory,
    Unwired.Fetch,
    Unwired.FrontPage,
    Unwired.Lander,
    Unwired.Projection,
    Unwired.Projects,
    Unwired.RepoHost,
    Unwired.RulesEvaluator,
    Unwired.Upstream
  );
