/**
 * pi, headless: print mode with JSON events (`-p --mode json`), sessions
 * kept in the workspace (`--session-dir`) under an id the swarm picks
 * (`--session-id`, which opens the session or creates it), so a resume is
 * the same command with a new prompt. pi asks no approvals, so it needs no
 * permission flag. `--no-mcp` keeps pi's built-in MCP off, so the user's
 * own servers (`~/.pi/agent/mcp.json`, with the user's accounts behind
 * them) never reach a contributor. The adapter's contributor loads the
 * CLI's pi adapter (issue 706) with `-e`, on the start and on every resume.
 *
 * The header line names the session; `agent_settled` says pi will not
 * continue on its own. JSON mode exits 0 when the provider fails, so the
 * stop reason comes from each assistant `message_end` (`stopReason`), never
 * from the exit code (PI §7).
 */
import { Option, Schema } from "effect";

import { HarnessEvent, lineAs, sessionDirOf, Tokens } from "./event.ts";
import type { HarnessDriver } from "./event.ts";

/** The CLI's pi adapter in this repo (issue 706), loaded with `-e`. */
export const piAdapter = decodeURIComponent(
  new URL("../../../../apps/cli/src/pi.ts", import.meta.url).pathname
);

/** The session header, JSON mode's first line. */
const Header = Schema.Struct({
  id: Schema.NonEmptyString,
  type: Schema.Literal("session"),
});

/** An assistant message, finished: why it stopped, and its usage. */
const MessageEnd = Schema.Struct({
  message: Schema.Struct({
    /** Set when the response failed (`stopReason` `error` or `aborted`). */
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

/** The flags every run shares: print mode, JSON events, no MCP, the session, the model, the adapter. */
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
