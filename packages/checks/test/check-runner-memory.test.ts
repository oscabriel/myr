import { describe, expect, it } from "@effect/vitest";
import type { LaneResult } from "@repo/protocol/domain/answer";
import { Command } from "@repo/protocol/domain/common";
import {
  CommitSha,
  LaneName,
  ProjectName,
  RepoName,
  TreeSha,
} from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { Effect, Result } from "effect";

import { CheckAt, CheckRunner } from "../src/check-runner.ts";
import type { CheckJob } from "../src/check-runner.ts";
import { CheckRunnerMemory } from "../src/check-runner/memory.ts";
import { redFirstOfRuns } from "../src/red-first.ts";

const tree = TreeSha.make("1".repeat(40));

const main = CommitSha.make("2".repeat(40));

const unit = LaneName.make("unit");

const lint = LaneName.make("lint");

const onTree = CheckAt.cases.Tree.make({ tree });

const onMain = CheckAt.cases.Commit.make({ commit: main });

const job = (at: CheckAt, ...lanes: readonly LaneName[]): CheckJob => ({
  at,
  lanes: lanes.map((lane) => ({ command: `bun run ${lane}`, lane })),
  placeholders: [],
  project: ProjectName.make("oscabriel/datekit"),
  proxies: [],
  repo: RepoName.make("datekit"),
  run: { checks: {}, test: Command.make("bun test {path}") },
});

const ran = (
  lane: LaneName,
  result: LaneResult["result"],
  durationMs: number
): LaneResult => ({ command: `bun run ${lane}`, durationMs, lane, result });

const run = (each: CheckJob) =>
  Effect.flatMap(CheckRunner, (runner) => runner.run(each));

describe(CheckRunnerMemory.layer, () => {
  it.effect(
    "returns the scripted results for a tree and lane in order, then repeats the last",
    () =>
      Effect.gen(function* () {
        const runs = yield* Effect.all(
          [
            run(job(onTree, unit)),
            run(job(onTree, unit)),
            run(job(onTree, unit)),
          ],
          { concurrency: 1 }
        );

        expect(runs.map(({ lanes }) => lanes)).toStrictEqual([
          [ran(unit, "failed", 30)],
          [ran(unit, "passed", 20)],
          [ran(unit, "passed", 20)],
        ]);
      }).pipe(
        Effect.provide(
          CheckRunnerMemory.layer(
            new Map([
              [
                `${tree}:${unit}`,
                [ran(unit, "failed", 30), ran(unit, "passed", 20)],
              ],
            ])
          )
        )
      )
  );

  it.effect(
    "keeps one script per tree or commit and lane, and totals the run's time",
    () =>
      Effect.gen(function* () {
        const onBoth = yield* run(job(onTree, unit, lint));
        const onMainAlone = yield* run(job(onMain, unit));

        expect(onBoth).toStrictEqual({
          durationMs: 40,
          evidence: [{ lane: lint, signature: "lint: scripted failure" }],
          heldBack: [],
          lanes: [ran(unit, "passed", 30), ran(lint, "failed", 10)],
        });
        expect(onMainAlone.lanes).toStrictEqual([ran(unit, "loadError", 5)]);
        expect(onMainAlone.evidence).toStrictEqual([{ lane: unit }]);
      }).pipe(
        Effect.provide(
          CheckRunnerMemory.layer(
            new Map([
              [`${tree}:${unit}`, [ran(unit, "passed", 30)]],
              [`${tree}:${lint}`, [ran(lint, "failed", 10)]],
              [`${main}:${unit}`, [ran(unit, "loadError", 5)]],
            ])
          )
        )
      )
  );

  it.effect("makes two scripted failures on main red first", () =>
    Effect.gen(function* () {
      const first = yield* run(job(onMain, unit));
      const second = yield* run(job(onMain, unit));

      expect(redFirstOfRuns([first, second], unit)).toStrictEqual(
        Result.succeed({ lane: unit, signature: "unit: scripted failure" })
      );
    }).pipe(
      Effect.provide(
        CheckRunnerMemory.layer(
          new Map([[`${main}:${unit}`, [ran(unit, "failed", 30)]]])
        )
      )
    )
  );

  it.effect("is VerifierBlocked for a tree and lane it has no script for", () =>
    Effect.gen(function* () {
      const blocked = yield* Effect.flip(run(job(onTree, unit, lint)));

      expect(blocked).toStrictEqual(new VerifierBlocked({}));
    }).pipe(
      Effect.provide(
        CheckRunnerMemory.layer(
          new Map([[`${tree}:${unit}`, [ran(unit, "passed", 30)]]])
        )
      )
    )
  );
});
