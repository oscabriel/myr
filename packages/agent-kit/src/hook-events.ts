/**
 * The hook events the CLI answers: `<cli> hook <event> --json`. The hook
 * configs agent-kit generates (issue 406) call it with these names, and the
 * CLI's `hook` command (issue 415) parses the same ones.
 */
import { Schema } from "effect";

/** When a harness asks the gate's policy: at the session's start, before a tool runs, at Stop. */
export const HookEvent = Schema.Literals([
  "session-start",
  "pre-tool-use",
  "stop",
]);

export type HookEvent = typeof HookEvent.Type;

/** The Claude Code hook event each one answers. */
export const claudeEventOf = {
  "pre-tool-use": "PreToolUse",
  "session-start": "SessionStart",
  stop: "Stop",
} as const satisfies Record<HookEvent, "SessionStart" | "PreToolUse" | "Stop">;

/**
 * The tools whose use the `pre-tool-use` hook guards: every Claude Code tool
 * that writes a file. The generated hook config matches them, and the CLI's
 * hook decides on the same names.
 */
export const guardedTools = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
] as const;
