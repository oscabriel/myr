import { Schema } from "effect";

export const HookEvent = Schema.Literals([
  "session-start",
  "pre-tool-use",
  "stop",
]);

export type HookEvent = typeof HookEvent.Type;

export const claudeEventOf = {
  "pre-tool-use": "PreToolUse",
  "session-start": "SessionStart",
  stop: "Stop",
} as const satisfies Record<HookEvent, "SessionStart" | "PreToolUse" | "Stop">;

export const guardedTools = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
] as const;
