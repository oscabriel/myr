import { Brand } from "@repo/brand";
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

const hookCommand = (event: HookEvent) => ({
  hooks: [{ command: `${Brand.cli} hook ${event} --json`, type: "command" }],
});

/**
 * Claude Code's `hooks`, as its plugin's `hooks/hooks.json` and a
 * `settings.json` both hold them. Each hook fails open: hooks are early
 * feedback, and the gateway decides.
 */
export const claudeHooks = () => ({
  hooks: Object.fromEntries(
    HookEvent.literals.map((event) => [
      claudeEventOf[event],
      [
        event === "pre-tool-use"
          ? { ...hookCommand(event), matcher: guardedTools.join("|") }
          : hookCommand(event),
      ],
    ])
  ),
});
