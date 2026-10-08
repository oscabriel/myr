/**
 * The seam to issue 711, which replaces this file: each contributor's
 * harness started headless in their workspace, and the verdict loop that
 * resumes the same session on a refusal. Until 711, `runAgent` starts
 * nothing and records the run as `failed`, so the swarm runs end to end.
 */
import { Console, Effect, Match } from "effect";
import type { FileSystem } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import type { Assignment } from "./plan.ts";
import type { AgentRun } from "./results.ts";
import type { Contributor } from "./roster.ts";
import type { AgentWorkspace } from "./workspace.ts";

/** One contributor's run: their harness on the brief, then the verdict loop. */
export type RunAgent = (input: {
  readonly assignment: Assignment;
  readonly workspace: AgentWorkspace;
  readonly brief: string;
  readonly maxContinuations: 3;
  readonly timeoutMs: number;
}) => Effect.Effect<
  AgentRun,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
>;

/** Not built (711): says so, starts nothing, and records the run as `failed`. */
export const runAgent: RunAgent = ({ assignment }) =>
  Effect.gen(function* () {
    const { adapter, handle, harness, model } = assignment.contributor;

    yield* Console.error(`${handle}: not built: 711`);

    return {
      adapter,
      ask: assignment.ask,
      attempts: 0,
      durationMs: 0,
      handle,
      harness,
      model,
      outcome: "failed",
      refusals: {},
    };
  });

/** The CLI's pi adapter (issue 706), which the adapter's agent loads with `-e`. */
const piAdapter = decodeURIComponent(
  new URL("../../../apps/cli/src/pi.ts", import.meta.url).pathname
);

/**
 * The argv that starts `contributor`'s harness headless on `brief`, in their
 * workspace `dir` (the plan prints it; nothing runs it until 711). These are
 * the headless invocations each harness's `--help` lists on this machine;
 * 711 replaces this with its drivers' `start`, which also allow every tool
 * where a harness needs a setting for it (Amp).
 */
export const startCommand = (input: {
  readonly contributor: Contributor;
  readonly brief: string;
  readonly dir: string;
}): readonly string[] => {
  const { adapter, handle, harness, model } = input.contributor;

  return Match.value(harness).pipe(
    Match.when("claude-code", () => [
      "claude",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--model",
      model,
      input.brief,
    ]),
    Match.when("opencode", () => [
      "opencode",
      "run",
      "--format",
      "json",
      "--auto",
      "-m",
      model,
      input.brief,
    ]),
    Match.when("amp", () => [
      "amp",
      "-x",
      input.brief,
      "--stream-json",
      "-m",
      model,
    ]),
    Match.when("pi", () => [
      "pi",
      "-p",
      "--mode",
      "json",
      "--session-dir",
      `${input.dir}/sessions`,
      "--session-id",
      handle,
      "--model",
      model,
      ...(adapter ? ["-e", piAdapter] : []),
      input.brief,
    ]),
    Match.exhaustive
  );
};
