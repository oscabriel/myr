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
import { StandingPosturesMemory } from "@repo/project/standing-posture/memory";
import { Contracts } from "@repo/protocol/contracts";
import { ProjectName } from "@repo/protocol/ids";
import {
  Anonymous,
  Authenticated,
  CurrentPrincipal,
} from "@repo/protocol/principal";
import { UnknownProject } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Layer, Ref } from "effect";
import { RpcTest } from "effect/rpc";

import { MemoryRateLimits, WorkerCaps } from "../src/adapters/rate-limits.ts";
import { Handlers } from "../src/handlers.ts";

const datekit = ProjectName.make("alice/datekit");

const ghost = ProjectName.make("alice/ghost");

/**
 * datekit's project, whose only answered read is the posture its ledger
 * shows, standing sealed; each read counted in `reads`.
 */
const datekitApi = (reads: Ref.Ref<number>) =>
  untouchable<ProjectApi>("ProjectApi", {
    standing: () =>
      Effect.as(
        Ref.update(reads, (count) => count + 1),
        {
          posture: "openWithSealedEvidence",
          seen: 1,
        }
      ),
  });

/** The handlers over projects whose datekit counts its reads in `reads`. */
const platformCounting = (reads: Ref.Ref<number>) =>
  Handlers.pipe(
    Layer.provide([
      Layer.succeed(
        Projects,
        Projects.of({
          create: () => Effect.die("a listing makes no project"),
          get: (project) =>
            project === datekit
              ? Effect.succeed(datekitApi(reads))
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

const platform = Layer.unwrap(
  Effect.map(Ref.make(0), (reads) => platformCounting(reads))
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

  it.effect(
    "keeps each posture it read where the platform keeps them, so the next list reads none",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0);

        const [first, second] = yield* Effect.gen(function* () {
          const anyone = yield* RpcTest.makeClient(Contracts);

          return [
            yield* anyone.listProjects({}),
            yield* anyone.listProjects({}),
          ] as const;
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              platformCounting(reads).pipe(
                Layer.provide(StandingPosturesMemory)
              ),
              anonymous
            )
          )
        );

        expect(second).toStrictEqual(first);
        expect(yield* Ref.get(reads)).toBe(1);
      })
  );
});
