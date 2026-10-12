import { Schema } from "effect";

export const HookInput = Schema.Struct({
  cwd: Schema.String,
  hook_event_name: Schema.String,
  session_id: Schema.NonEmptyString,
  stop_hook_active: Schema.optionalKey(Schema.Boolean),
  tool_input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  tool_name: Schema.optionalKey(Schema.String),
});

export type HookInput = typeof HookInput.Type;

export const decodeHookInput = Schema.decodeUnknownEffect(
  Schema.fromJsonString(HookInput)
);
