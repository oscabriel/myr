// `--no-mcp` keeps the machine's own MCP servers away from a contributor. JSON mode
// exits 0 when the provider fails, so the stop reason comes from each
// `message_end`, never the exit code.
import { Option, Schema } from "effect";

import { HarnessEvent, lineAs, sessionDirOf, Tokens } from "./event.ts";
import type { HarnessDriver } from "./event.ts";

export const piAdapter = decodeURIComponent(
  new URL("../../../../apps/cli/src/pi.ts", import.meta.url).pathname
);

const Header = Schema.Struct({
  id: Schema.NonEmptyString,
  type: Schema.Literal("session"),
});

const MessageEnd = Schema.Struct({
  message: Schema.Struct({
    errorMessage: Schema.optionalKey(Schema.String),
    role: Schema.Literal("assistant"),
    stopReason: Schema.optionalKey(Schema.String),
    usage: Schema.optionalKey(
      Schema.Struct({
        cacheRead: Schema.optionalKey(Tokens),
        cacheWrite: Schema.optionalKey(Tokens),
        input: Tokens,
        output: Tokens,
      })
    ),
  }),
  type: Schema.Literal("message_end"),
});

const Settled = Schema.Struct({ type: Schema.Literal("agent_settled") });

const headerOf = lineAs(Header);

const messageEndOf = lineAs(MessageEnd);

const settledOf = lineAs(Settled);

const parse = (line: string): readonly HarnessEvent[] => {
  const header = headerOf(line);

  if (Option.isSome(header)) {
    return [HarnessEvent.SessionStarted({ id: header.value.id })];
  }

  const end = messageEndOf(line);

  if (Option.isSome(end)) {
    const { errorMessage, stopReason, usage } = end.value.message;

    return [
      HarnessEvent.Usage({
        input:
          (usage?.input ?? 0) +
          (usage?.cacheRead ?? 0) +
          (usage?.cacheWrite ?? 0),
        output: usage?.output ?? 0,
        stopReason: Option.fromUndefinedOr(stopReason),
      }),
      ...(stopReason === "error" || stopReason === "aborted"
        ? [
            HarnessEvent.Failed({
              reason:
                errorMessage === undefined
                  ? stopReason
                  : `${stopReason}: ${errorMessage}`,
            }),
          ]
        : []),
    ];
  }

  return Option.isSome(settledOf(line))
    ? [HarnessEvent.Settled({ stopReason: Option.none() })]
    : [];
};

const headless = (input: {
  readonly sessionDir: string;
  readonly session: string;
  readonly model: string;
  readonly adapter: boolean;
}) => [
  "-p",
  "--mode",
  "json",
  "--no-mcp",
  "--session-dir",
  input.sessionDir,
  "--session-id",
  input.session,
  "--model",
  input.model,
  ...(input.adapter ? ["-e", piAdapter] : []),
];

export const pi: HarnessDriver = {
  files: () => [],
  harness: "pi",
  parse,
  resume: ({ adapter, model, prompt, session, workspace }) => [
    "pi",
    ...headless({
      adapter,
      model,
      session,
      sessionDir: sessionDirOf(workspace.dir),
    }),
    prompt,
  ],
  start: ({ adapter, brief, model, sessionDir, sessionKey }) => [
    "pi",
    ...headless({ adapter, model, session: sessionKey, sessionDir }),
    brief,
  ],
};
