import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import {
  CommitSha,
  Handle,
  LandedSha,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { RepoBusy, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import { Effect, Option, Result } from "effect";

import { Lander, Rebuild } from "../src/lander.ts";
import type { LandJob, MergeJob } from "../src/lander.ts";
import { LanderJob, LanderMemory } from "../src/lander/memory.ts";

const sha = (n: number) => n.toString(16).padStart(40, "0");

const demo = RepoName.make("demo");

const main = LandedSha.make(CommitSha.make(sha(1)));

const mergeJob: MergeJob = {
  base: CommitSha.make(sha(1)),
  fork: RepoName.make("demo--fix-parser--alice"),
  head: CommitSha.make(sha(2)),
  main,
  repo: demo,
};

const tree = TreeSha.make(sha(3));

const landJob: LandJob = {
  author: Handle.make("alice"),
  main,
  message: "Fix the parser\n",
  rebuild: Rebuild.Merge({
    base: mergeJob.base,
    fork: mergeJob.fork,
    head: mergeJob.head,
  }),
  repo: demo,
  requestId: RequestId.make("request-fix-parser-1"),
  tree,
  verdict: Option.none(),
};

const stale = new StaleBase({
  base: mergeJob.base,
  conflicts: [RepoPath.make("src/a.ts")],
  main,
});

const landedAt = LandedSha.make(CommitSha.make(sha(4)));

describe("the scripted Lander", () => {
  it.effect(
    "returns each operation's scripted results in order, then the last one again",
    () => {
      const scripted = LanderMemory.layer({
        land: [
          Result.fail(new RepoBusy({})),
          Result.succeed({ pending: ["notes"], sha: landedAt }),
        ],
        merge: [Result.fail(stale), Result.succeed({ changes: [], tree })],
      });

      return Effect.gen(function* () {
        const lander = yield* Lander;

        const merges = yield* Effect.forEach([1, 2, 3], () =>
          Effect.result(lander.merge(mergeJob))
        );

        const lands = yield* Effect.forEach([1, 2, 3], () =>
          Effect.result(lander.land(landJob))
        );

        expect(merges).toStrictEqual([
          Result.fail(stale),
          Result.succeed({ changes: [], tree }),
          Result.succeed({ changes: [], tree }),
        ]);
        expect(lands).toStrictEqual([
          Result.fail(new RepoBusy({})),
          Result.succeed({ pending: ["notes"], sha: landedAt }),
          Result.succeed({ pending: ["notes"], sha: landedAt }),
        ]);
      }).pipe(Effect.provide(scripted));
    }
  );

  it.effect("is VerifierBlocked for an operation with no script", () =>
    Effect.gen(function* () {
      const lander = yield* Lander;

      expect(
        yield* Effect.flip(lander.bundleRules({ at: main, repo: demo }))
      ).toStrictEqual(new VerifierBlocked({}));
    }).pipe(Effect.provide(LanderMemory.layer({})))
  );

  it.effect("records the jobs it was given, in order", () => {
    const files = [
      {
        content: "export default {}\n",
        path: RepoPath.make(`${Brand.configDir}/asks/x.ask.ts`),
      },
    ] as const;

    const scripted = LanderMemory.layer({
      bundle: [
        Result.succeed({
          entry: `${Brand.configDir}/project.ts`,
          modules: {},
          sdkVersion: "0.0.0",
        }),
      ],
      compose: [Result.succeed({ commit: CommitSha.make(sha(5)), tree })],
      land: [Result.succeed({ pending: [], sha: landedAt })],
      merge: [Result.succeed({ changes: [], tree })],
    });

    return Effect.gen(function* () {
      const lander = yield* Lander;

      yield* lander.compose({ files, main, repo: demo });
      yield* lander.merge(mergeJob);
      yield* lander.land(landJob);
      yield* lander.bundleRules({ at: landedAt, repo: demo });

      expect(yield* scripted.jobs).toStrictEqual([
        LanderJob.Compose({ job: { files, main, repo: demo } }),
        LanderJob.Merge({ job: mergeJob }),
        LanderJob.Land({ job: landJob }),
        LanderJob.BundleRules({ job: { at: landedAt, repo: demo } }),
      ]);
    }).pipe(Effect.provide(scripted));
  });
});
