import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { claudeEventOf, HookEvent } from "../src/hook-events.ts";

describe("the hook events a harness calls the CLI with", () => {
  it("are the three the generated hooks name", () => {
    expect(HookEvent.literals).toStrictEqual([
      "session-start",
      "pre-tool-use",
      "stop",
    ]);
  });

  it("each answer one Claude Code hook event", () => {
    expect(
      HookEvent.literals.map((event) => [event, claudeEventOf[event]])
    ).toStrictEqual([
      ["session-start", "SessionStart"],
      ["pre-tool-use", "PreToolUse"],
      ["stop", "Stop"],
    ]);
  });

  it("refuse any other event name", () => {
    expect(Schema.is(HookEvent)("post-tool-use")).toBeFalsy();
  });
});
