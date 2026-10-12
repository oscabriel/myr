// `--strict-mcp-config` with no `--mcp-config`: else the machine's own MCP servers
// and claude.ai connectors load, with their accounts behind them. Amp's
// `--stream-json` is Claude Code-compatible, so `streamJsonEvents` reads both.
import { Option, Schema } from "effect";

import { HarnessEvent, lineAs, Tokens } from "./event.ts";
import type { HarnessDriver } from "./event.ts";

const Init = Schema.Struct({
  session_id: Schema.NonEmptyString,
  subtype: Schema.Literal("init"),
  type: Schema.Literal("system"),
});

const ApiUsage = Schema.Struct({
  cache_creation_input_tokens: Schema.optionalKey(Schema.NullOr(Tokens)),
  cache_read_input_tokens: Schema.optionalKey(Schema.NullOr(Tokens)),
  input_tokens: Tokens,
  output_tokens: Tokens,
});

const Assistant = Schema.Struct({
  message: Schema.Struct({
    stop_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
    usage: Schema.optionalKey(ApiUsage),
  }),
  type: Schema.Literal("assistant"),
});

const Result = Schema.Struct({
  is_error: Schema.optionalKey(Schema.Boolean),
  subtype: Schema.NonEmptyString,
  type: Schema.Literal("result"),
  usage: Schema.optionalKey(ApiUsage),
});

const initOf = lineAs(Init);

const assistantOf = lineAs(Assistant);

const resultOf = lineAs(Result);

// Cached input counts as input.
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

// Claude Code totals usage on the `result` line (its assistant lines repeat it);
// Amp reports it only on each assistant message.
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
