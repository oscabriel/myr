/**
 * The swarm's six fictional contributors: "4 harnesses, 6 models". Each is
 * one person (a `SESSION_TOKENS` entry on the stage, a named session beside
 * accounts) with one harness and one model, vouched in burrow's
 * `vouched.td`, so their claims are not `NotVouched`.
 *
 * The model ids are what this machine's harnesses list and run (2026-10-08):
 * `opencode models` for OpenCode's GPT model, `pi --offline --list-models`
 * for pi's (its ready provider is `opencode-go`), `amp --help` for Amp's
 * modes. tamsin ran `openai/gpt-5.5` on OpenCode's ChatGPT sign-in until
 * that account's usage limit ran out in the swarm's live rehearsal (804,
 * not back before Oct 16); OpenCode Go's `gpt-6-luna` ran headless in its
 * place, and putting the ChatGPT model back is tamsin's one line.
 */
import { Handle } from "@repo/protocol/ids";
import { Schema } from "effect";

import { Harness } from "./results.ts";

/** One contributor: a person, the harness they run, and its model. */
export const Contributor = Schema.Struct({
  /** True only for the pi agent that loads the CLI's pi adapter (`-e`). */
  adapter: Schema.Boolean,
  /** A fictional person: a key of the stage's `SESSION_TOKENS` (human step H5 on demo). */
  handle: Handle,
  harness: Harness,
  /**
   * Claude Code: an Anthropic model id. OpenCode: `<provider>/<gpt id>`.
   * Amp: its mode. pi: `<provider>/<id>`.
   */
  model: Schema.NonEmptyString,
});

export type Contributor = typeof Contributor.Type;

/**
 * The six, in the order the plan hands them asks. Contributor 2 (tamsin)
 * and 3 (ivo) are the ones the `video` scenario nudges (`scenario.ts`).
 */
export const roster: readonly [
  Contributor,
  Contributor,
  Contributor,
  Contributor,
  Contributor,
  Contributor,
] = [
  // The "stock harness, nothing installed" beat.
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
  // The tier-2 beat: the pi adapter's brief, scope guard and verdict gate.
  // It ran OpenCode Zen's `opencode/gemini-3.8-flash` until pi here proved
  // to have no OpenCode Zen key; the qwen flash ran the adapter live.
  {
    adapter: true,
    handle: Handle.make("pell"),
    harness: "pi",
    model: "opencode-go/qwen3.8-flash",
  },
];
