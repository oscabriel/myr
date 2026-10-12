import { findRunBlock } from "@repo/checks/finder";
import { judgeClosure } from "@repo/checks/judge";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Command, Glob } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import { RunBlock } from "@repo/protocol/domain/run";
import { Array, Effect, Option, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { judgeFilesAt } from "../local/judge-files.ts";

export const askJudge = (
  closure: Policy["judge"],
  ask: Ask
): Policy["judge"] => {
  const own = [
    ask.file,
    ...(CheckSpec.guards.RedThenGreen(ask.check) ? [ask.check.path] : []),
  ].map((path) => Glob.make(`/${path}`));

  return {
    paths: Array.dedupe([...closure.paths, ...own]),
    pointers: closure.pointers,
  };
};

const decodeRun = Schema.decodeUnknownOption(RunBlock);

/** The config folder's run block needs the config evaluated, which only `<cli> check` does, so the claim's check command stands in. */
export const judgeAt = (input: {
  readonly root: string;
  readonly base: string;
  readonly test: string;
}): Effect.Effect<
  Policy["judge"],
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.map(judgeFilesAt(input.root, input.base), (files) => {
    const found = findRunBlock(files).run;

    const run = Option.getOrElse(
      decodeRun({ checks: {}, test: input.test, ...found }),
      (): RunBlock => ({ checks: {}, test: Command.make(input.test) })
    );

    return judgeClosure(run, files);
  });
