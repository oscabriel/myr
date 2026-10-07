import { NodeServices } from "@effect/platform-node";
import { describe, expect, it, vi } from "@effect/vitest";
import { Command } from "@repo/protocol/domain/common";
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
    run: { checks: {}, test: Command.make("bun test {path}") },
  });

  return { checkout, job, repo };
});

// What git exports to a hook that runs the CLI: its own repo, and the config
// given with `git -c`. Restored when the test's scope closes.
const inHook = (repo: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      vi.stubEnv("GIT_DIR", `${repo}/.git`);
      vi.stubEnv("GIT_CONFIG_PARAMETERS", "'user.name'='Hook'");
    }),
    () => Effect.sync(() => vi.unstubAllEnvs())
  );

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

  it.live("gives a job a HOME of its own, and removes it after the job", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { checkout, job } = yield* world;
      const seen = yield* fs.makeTempDirectoryScoped({ prefix: "seen-" });

      const ran = yield* Effect.flatMap(CheckRunner, (runner) =>
        runner.run(job([lane("home", `printf %s "$HOME" > "${seen}/home"`)]))
      ).pipe(Effect.provide(CheckRunnerLocal.layer({ checkout })));

      const home = yield* fs.readFileString(`${seen}/home`);

      expect(ran.lanes.map(({ result }) => result)).toStrictEqual(["passed"]);
      expect(home).toContain("check-home-");
      expect(yield* fs.exists(home)).toBeFalsy();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "keeps the repo and git config of a hook that runs it away from a lane's git",
    () =>
      Effect.gen(function* () {
        const { checkout, job, repo } = yield* world;

        yield* inHook(repo);

        const ran = yield* Effect.flatMap(CheckRunner, (runner) =>
          runner.run(
            job([
              lane(
                "own-repo",
                `test "$(git rev-parse --absolute-git-dir)" = "$(pwd -P)/.git"`
              ),
              lane("no-hook-config", `test -z "$(git config --get user.name)"`),
            ])
          )
        ).pipe(Effect.provide(CheckRunnerLocal.layer({ checkout })));

        expect(
          ran.lanes.map(({ lane: name, result }) => [name, result])
        ).toStrictEqual([
          ["own-repo", "passed"],
          ["no-hook-config", "passed"],
        ]);
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
