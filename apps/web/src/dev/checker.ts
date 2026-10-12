import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import type { CheckJob } from "@repo/checks/check-runner";
import { CheckRunnerMemory, scriptKey } from "@repo/checks/check-runner/memory";
import type { LaneResult } from "@repo/protocol/domain/answer";
import { Context, Effect, Layer } from "effect";

import { printedBy } from "./examples.ts";

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
