import { Handle } from "@repo/protocol/ids";
import { Schema } from "effect";

import { Harness } from "./results.ts";

export const Contributor = Schema.Struct({
  adapter: Schema.Boolean,
  handle: Handle,
  harness: Harness,
  // Claude Code: an Anthropic model id. OpenCode: `<provider>/<gpt id>`. Amp: its mode. pi: `<provider>/<id>`.
  model: Schema.NonEmptyString,
});

export type Contributor = typeof Contributor.Type;

// Contributors 2 (tamsin) and 3 (ivo) are the ones the `video` scenario nudges.
export const roster: readonly [
  Contributor,
  Contributor,
  Contributor,
  Contributor,
  Contributor,
  Contributor,
] = [
  {
    adapter: false,
    handle: Handle.make("wren"),
    harness: "claude-code",
    model: "claude-opus-5-5",
  },
  {
    adapter: false,
    handle: Handle.make("tamsin"),
    harness: "opencode",
    model: "opencode-go/gpt-6-luna",
  },
  {
    adapter: false,
    handle: Handle.make("ivo"),
    harness: "amp",
    model: "medium",
  },
  {
    adapter: false,
    handle: Handle.make("marisol"),
    harness: "pi",
    model: "opencode-go/kimi-k3",
  },
  {
    adapter: false,
    handle: Handle.make("dagny"),
    harness: "pi",
    model: "opencode-go/glm-5.3",
  },
  {
    adapter: true,
    handle: Handle.make("pell"),
    harness: "pi",
    model: "opencode-go/qwen3.8-flash",
  },
];
