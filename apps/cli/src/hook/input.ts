/**
 * What a harness hands a hook on stdin, in Claude Code's hook format (which
 * Cursor and Copilot CLI also read), decoded at the boundary. Only the fields
 * the hook policy reads; the rest of the payload is ignored.
 */
import { Schema } from "effect";

export const HookInput = Schema.Struct({
  /** The folder the harness runs in. */
  cwd: Schema.String,
  hook_event_name: Schema.String,
  /** The harness's session: holds and facts are kept per session. */
  session_id: Schema.NonEmptyString,
  /** Claude Code: `true` when this stop follows a Stop hook's hold. */
  stop_hook_active: Schema.optionalKey(Schema.Boolean),
  /** PreToolUse: the tool's arguments. */
  tool_input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  /** PreToolUse: the tool about to run. */
  tool_name: Schema.optionalKey(Schema.String),
});

export type HookInput = typeof HookInput.Type;

/** The whole of stdin, as JSON text, to a `HookInput`. */
export const decodeHookInput = Schema.decodeUnknownEffect(
  Schema.fromJsonString(HookInput)
);
