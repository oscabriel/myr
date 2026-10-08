/**
 * Claude Code, headless: `claude -p` with stream JSON, every tool allowed
 * (`--permission-mode bypassPermissions`: no one is there to approve), no
 * MCP server (`--strict-mcp-config` with no `--mcp-config`: else the user's
 * own servers and claude.ai connectors load, with the user's accounts
 * behind them), and `--resume <id>` to continue the same session. The
 * `system`/`init` line names the session; the `result` line closes the run
 * with its usage.
 *
 * Amp's `--stream-json` is "Claude Code-compatible", so `streamJsonEvents`
 * reads both.
 */
import { Option, Schema } from "effect";

import { HarnessEvent, lineAs, Tokens } from "./event.ts";
import type { HarnessDriver } from "./event.ts";

/** The `system`/`init` line: the session's id. */
const Init = Schema.Struct({
  session_id: Schema.NonEmptyString,
  subtype: Schema.Literal("init"),
  type: Schema.Literal("system"),
});

/** A model response's usage, as Anthropic's API reports it. */
const ApiUsage = Schema.Struct({
  cache_creation_input_tokens: Schema.optionalKey(Schema.NullOr(Tokens)),
  cache_read_input_tokens: Schema.optionalKey(Schema.NullOr(Tokens)),
  input_tokens: Tokens,
  output_tokens: Tokens,
});

/** One assistant message, with its stop reason and usage (Amp prints usage here). */
const Assistant = Schema.Struct({
  message: Schema.Struct({
    stop_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
    usage: Schema.optionalKey(ApiUsage),
  }),
  type: Schema.Literal("assistant"),
});

/** The `result` line: the run is over (`subtype` says how), with its usage (Claude Code). */
const Result = Schema.Struct({
  /** Whether the run failed; `subtype` then says how (`error_during_execution`). */
  is_error: Schema.optionalKey(Schema.Boolean),
  subtype: Schema.NonEmptyString,
  type: Schema.Literal("result"),
  usage: Schema.optionalKey(ApiUsage),
});

const initOf = lineAs(Init);

const assistantOf = lineAs(Assistant);

const resultOf = lineAs(Result);

/** Tokens in and out, counting cached input as input. */
const usageOf = (
  usage: typeof ApiUsage.Type,
  stopReason: Option.Option<string>
) =>
  HarnessEvent.Usage({
    input:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    output: usage.output_tokens,
    stopReason,
  });

/**
 * What one line of Claude Code-style stream JSON says. Usage is read where
 * the harness totals it: the `result` line (Claude Code, whose assistant
 * lines repeat what the result sums) or each assistant message (Amp, whose
 * result carries none).
 */
export const streamJsonEvents =
  (usageFrom: "result" | "assistant") =>
  (line: string): readonly HarnessEvent[] => {
    const init = initOf(line);

    if (Option.isSome(init)) {
      return [HarnessEvent.SessionStarted({ id: init.value.session_id })];
    }

    const assistant = assistantOf(line);

    if (Option.isSome(assistant)) {
      const { stop_reason: stopReason, usage } = assistant.value.message;

      return usageFrom === "assistant" && usage !== undefined
        ? [usageOf(usage, Option.fromNullishOr(stopReason))]
        : [];
    }

    return Option.match(resultOf(line), {
      onNone: () => [],
      onSome: ({ is_error: isError, subtype, usage }) => [
        ...(usageFrom === "result" && usage !== undefined
          ? [usageOf(usage, Option.none())]
          : []),
        ...(isError === true || subtype.startsWith("error")
          ? [HarnessEvent.Failed({ reason: subtype })]
          : []),
        HarnessEvent.Settled({ stopReason: Option.some(subtype) }),
      ],
    });
  };

/** The flags every run shares: print mode, stream JSON, no one to ask, no MCP, the model. */
const headless = (model: string) => [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--permission-mode",
  "bypassPermissions",
  "--strict-mcp-config",
  "--model",
  model,
];

export const claudeCode: HarnessDriver = {
  files: () => [],
  harness: "claude-code",
  parse: streamJsonEvents("result"),
  resume: ({ model, prompt, session }) => [
    "claude",
    ...headless(model),
    "--resume",
    session,
    prompt,
  ],
  start: ({ brief, model }) => ["claude", ...headless(model), brief],
};
