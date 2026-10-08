/**
 * The dev world's Checker: the scripted `/memory` adapter, with a script it
 * writes as it goes, by one rule. A commit is checked only when a decider's
 * ask files are composed onto main, where the ask's check is red first, so
 * every lane fails there, the same way each time; a tree is checked only
 * when an answer is merged, and every lane passes there. A count lane (a
 * migrate ask's callers) prints what the examples state its command prints
 * on the project's first commit (`printedBy`), wherever it runs. No check
 * runs: the world shows the platform's flow, not a project's tests.
 */
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import type { CheckJob } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import type { LaneResult } from "@repo/protocol/domain/answer";
import { Context, Effect, Layer } from "effect";

import { printedBy } from "./examples.ts";

/** What a lane comes to where it runs: red on a composed commit, green on a merged tree. */
const scripted = (
  job: CheckJob,
  lane: CheckJob["lanes"][number]
): LaneResult => ({
  command: lane.command,
  durationMs: 1,
  lane: lane.lane,
  result: CheckAt.match(job.at, {
    Commit: () => "failed" as const,
    Tree: () => "passed" as const,
  }),
});

export const DevChecker: Layer.Layer<CheckRunner> = Layer.effect(
  CheckRunner,
  Effect.gen(function* () {
    const script = new Map<string, readonly LaneResult[]>();
    const outputs = new Map<string, string>();

    const memory = Context.get(
      yield* Layer.build(CheckRunnerMemory.layer(script, outputs)),
      CheckRunner
    );

    return CheckRunner.of({
      run: (job) =>
        Effect.suspend(() => {
          for (const lane of job.lanes) {
            const key = scriptKey(job.at, lane.lane);

            if (!script.has(key)) {
              script.set(key, [scripted(job, lane)]);
            }

            const printed = printedBy.get(lane.command);

            if (lane.output === "stdout" && printed !== undefined) {
              outputs.set(key, printed);
            }
          }

          return memory.run(job);
        }),
    });
  })
);
