/**
 * `listProjects` as the platform's handlers answer it: the projection lists
 * each project, and each listed project's posture is the one its own
 * ledger stands at now, so the badge and the ledger say the same. The
 * projection here lists datekit as `open`, the row D1 holds for a project
 * whose first config declared sealed checks (that config writes no
 * `PostureChanged` row); datekit's ledger stands sealed. A project the
 * platform never made keeps the posture the projection listed.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import { EvidenceStoreMemory } from "@repo/checks/evidence-store/memory";
import { FrontPageMemory } from "@repo/project/front-page/memory";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import { Contracts } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import {
  Anonymous,
  Authenticated,
  CurrentPrincipal,
} from "@repo/protocol/principal";
import { UnknownProject } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/rpc";

import { MemoryRateLimits, WorkerCaps } from "../src/adapters/rate-limits.ts";
import { Handlers } from "../src/handlers.ts";

const datekit = ProjectName.make("datekit");

const ghost = ProjectName.make("ghost");

/** datekit's project, whose only answered read is its ledger, standing sealed. */
const datekitApi = untouchable<ProjectApi>("ProjectApi", {
  ledger: () =>
    Effect.succeed({
      entries: [],
      layers: [],
      posture: "openWithSealedEvidence",
      postureLabel: "Open with sealed evidence",
      project: datekit,
    }),
});

const platform = Handlers.pipe(
  Layer.provide([
    Layer.succeed(
      Projects,
      Projects.of({
        create: () => Effect.die("a listing makes no project"),
        get: (project) =>
          project === datekit
            ? Effect.succeed(datekitApi)
            : Effect.fail(new UnknownProject({ project })),
      })
    ),
    FrontPageMemory.layer({
      credits: [],
      entries: [],
      projects: [
        { openAsks: 3, posture: "open", project: datekit },
        { openAsks: 0, posture: "openCore", project: ghost },
      ],
    }),
    MemoryRateLimits(WorkerCaps),
    EvidenceStoreMemory,
    Layer.succeed(RepoHost, untouchable<RepoHost["Service"]>("RepoHost")),
  ])
);

const anonymous = Layer.succeed(Authenticated, (effect) =>
  Effect.provideService(effect, CurrentPrincipal, Anonymous.make({}))
);

describe("the platform's project list", () => {
  it.effect("gives each project the posture its ledger stands at", () =>
    Effect.gen(function* () {
      const anyone = yield* RpcTest.makeClient(Contracts);

      expect(yield* anyone.listProjects({})).toStrictEqual({
        projects: [
          {
            openAsks: 3,
            posture: "openWithSealedEvidence",
            project: datekit,
          },
          { openAsks: 0, posture: "openCore", project: ghost },
        ],
      });
    }).pipe(Effect.provide(Layer.mergeAll(platform, anonymous)))
  );
});
