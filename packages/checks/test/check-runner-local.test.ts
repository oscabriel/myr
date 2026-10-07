import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  AreaName,
  CommitSha,
  LaneName,
  ProjectName,
  RepoName,
  SuiteRoot,
} from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { gitOk } from "@repo/testkit/git";
import { Effect, FileSystem } from "effect";

import { CheckAt, CheckRunner } from "../src/check-runner.ts";
import type { CheckJob } from "../src/check-runner.ts";
import { CheckRunnerLocal } from "../src/check-runner/local.ts";

const lane = (name: string, command: string) => ({
  command,
  lane: LaneName.make(name),
});

/**
 * A git repo whose `test` script fails, and a runner whose checkout copies
 * it into a fresh temp dir for each job.
 */
const world = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const repo = yield* fs.makeTempDirectoryScoped({ prefix: "datekit-" });

  yield* fs.writeFileString(
    `${repo}/package.json`,
    JSON.stringify({
      name: "datekit",
      private: true,
      scripts: { test: `node -e "process.exit(1)"` },
    })
  );
  yield* gitOk(repo, "init", "--quiet", "--initial-branch=main");
  yield* gitOk(repo, "add", "--all");
  yield* gitOk(repo, "commit", "--quiet", "--message", "Add datekit");

  const head = CommitSha.make(yield* gitOk(repo, "rev-parse", "HEAD"));

  const checkout = () =>
    fs.makeTempDirectoryScoped({ prefix: "checkout-" }).pipe(
      Effect.tap((dir) => fs.copy(repo, dir, { overwrite: true })),
      Effect.mapError(() => new VerifierBlocked({}))
    );

  const job = (lanes: CheckJob["lanes"]): CheckJob => ({
    at: CheckAt.cases.Commit.make({ commit: head }),
    lanes,
    placeholders: [],
    project: ProjectName.make("datekit"),
    proxies: [],
    repo: RepoName.make("datekit"),
  });

  return { checkout, job };
});

describe(CheckRunnerLocal.layer, () => {
  it.live("runs each lane as a process in a checkout, and classifies it", () =>
    Effect.gen(function* () {
      const { checkout, job } = yield* world;

      const ran = yield* Effect.flatMap(CheckRunner, (runner) =>
        runner.run(
          job([
            lane("test", "bun run test"),
            lane("ok", "exit 0"),
            // The user's git config never reaches a lane.
            lane(
              "isolated",
              `test -z "$(git config --global --get user.name)"`
            ),
          ])
        )
      ).pipe(Effect.provide(CheckRunnerLocal.layer({ checkout })));

      expect(
        ran.lanes.map(({ lane: name, result }) => [name, result])
      ).toStrictEqual([
        ["test", "failed"],
        ["ok", "passed"],
        ["isolated", "passed"],
      ]);
      expect(ran.lanes[0]?.durationMs).toBeGreaterThan(0);
      expect(ran.durationMs).toBeGreaterThanOrEqual(
        ran.lanes[0]?.durationMs ?? 0
      );
      expect(ran.evidence).toStrictEqual([{ lane: LaneName.make("test") }]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("stops a lane at its time limit and calls it blocked", () =>
    Effect.gen(function* () {
      const { checkout, job } = yield* world;

      const ran = yield* Effect.flatMap(CheckRunner, (runner) =>
        runner.run(job([{ ...lane("slow", "sleep 5"), timeoutMs: 300 }]))
      ).pipe(Effect.provide(CheckRunnerLocal.layer({ checkout })));

      expect(ran.lanes[0]?.result).toBe("blocked");
      expect(ran.lanes[0]?.durationMs).toBeGreaterThanOrEqual(300);
      expect(ran.lanes[0]?.durationMs).toBeLessThan(4000);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "is VerifierBlocked for a held-back suite, which only the Checker runs",
    () =>
      Effect.gen(function* () {
        const { checkout, job } = yield* world;

        const blocked = yield* Effect.flatMap(CheckRunner, (runner) =>
          runner.run({
            ...job([lane("ok", "exit 0")]),
            heldBack: {
              areas: [AreaName.make("parse")],
              at: CommitSha.make("3".repeat(40)),
              layerRepo: RepoName.make("datekit--maintainers"),
              suite: SuiteRoot.make(`sha256:${"4".repeat(64)}`),
            },
          })
        ).pipe(
          Effect.provide(CheckRunnerLocal.layer({ checkout })),
          Effect.flip
        );

        expect(blocked).toStrictEqual(new VerifierBlocked({}));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
