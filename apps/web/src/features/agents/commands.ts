/**
 * `docs/reference/commands.json` as the web reads it: every CLI command,
 * one row each, written by `bun run gen` and held current by `gen:check`.
 * The web takes only what `llms.txt` prints and ignores the rest of a row.
 */
import { Schema } from "effect";

/** One command: its words, its arguments, its flags and what it does. */
export const CommandRow = Schema.Struct({
  description: Schema.String,
  /** Every flag it takes, as typed: `--project`, `--json`. */
  flags: Schema.Array(Schema.String),
  /** It runs only with `--yes`. */
  needsApproval: Schema.Boolean,
  /** The words after the CLI's name: `["env", "set"]`. */
  path: Schema.NonEmptyArray(Schema.String),
  /** The arguments it takes in order, by name. */
  positional: Schema.Array(Schema.String),
  readOnly: Schema.Boolean,
  source: Schema.Literals(["contract", "local"]),
});

export const CommandsJson = Schema.Struct({
  commands: Schema.Array(CommandRow),
  version: Schema.Literal(1),
});

export type CommandsJson = typeof CommandsJson.Type;
