/**
 * The judge closure a hook session decides by: the closure `@repo/checks`
 * computes over the repo's files at the claim's base (the files the
 * platform reads, gathered by the same `judgeInputs`), plus the ask's own
 * files, which the gate's shape stage judges for every answer.
 */
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

/**
 * The closure with the ask's own files (its file in the config folder, and
 * a `redThenGreen` check's file), each anchored at the root: the gate's shape
 * stage judges them for every answer to the ask.
 */
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

// ------------------------------------------------------------ at the base

const decodeRun = Schema.decodeUnknownOption(RunBlock);

/**
 * The judge closure at `base`, as `@repo/checks` computes it over the files
 * the platform reads there: every file of its tree, with the text of each
 * one the finder or the closure reads, gathered by the same `judgeInputs`
 * the platform and `<cli> check` gather through (none when git cannot read
 * `base`). The run block is the one the finder finds in those files, with
 * the claim's check command as its `test` when it finds none: the config
 * folder's own run block needs the config evaluated, which only
 * `<cli> check` does.
 */
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
