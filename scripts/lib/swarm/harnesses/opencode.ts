/**
 * OpenCode, headless: `opencode run` with JSON events, permissions approved
 * (`--auto`), and `-s <id>` to continue a session. `--standalone` runs a
 * private server in the contributor's env instead of the user's background
 * service, so the agent's tools see the workspace's env and nobody else's.
 *
 * Every event names its session (`sessionID`); a `step_start` opens each
 * step, and a `step_finish` closes it with its tokens. The run's last step
 * prints no `step_finish` before the process exits (seen on 2.0.7), so the
 * run settles when the process exits; an `error` event settles it at once.
 */
import { Option, Schema } from "effect";

import { HarnessEvent, lineAs, Tokens } from "./event.ts";
import type { HarnessDriver } from "./event.ts";

/** A step's first event: names the session. */
const StepStart = Schema.Struct({
  sessionID: Schema.NonEmptyString,
  type: Schema.Literal("step_start"),
});

/** A step's last event: why it stopped, and its tokens. */
const StepFinish = Schema.Struct({
  part: Schema.Struct({
    reason: Schema.optionalKey(Schema.String),
    tokens: Schema.Struct({
      cache: Schema.optionalKey(Schema.Struct({ read: Tokens, write: Tokens })),
      input: Tokens,
      output: Tokens,
      reasoning: Schema.optionalKey(Tokens),
    }),
  }),
  type: Schema.Literal("step_finish"),
});

/** The run failed: the provider refused the model, say. */
const ErrorEvent = Schema.Struct({
  error: Schema.Struct({
    message: Schema.optionalKey(Schema.String),
    type: Schema.String,
  }),
  type: Schema.Literal("error"),
});

const stepStartOf = lineAs(StepStart);

const stepFinishOf = lineAs(StepFinish);

const errorOf = lineAs(ErrorEvent);

const parse = (line: string): readonly HarnessEvent[] => {
  const start = stepStartOf(line);

  if (Option.isSome(start)) {
    return [HarnessEvent.SessionStarted({ id: start.value.sessionID })];
  }

  const finish = stepFinishOf(line);

  if (Option.isSome(finish)) {
    const { reason, tokens } = finish.value.part;

    return [
      HarnessEvent.Usage({
        input:
          tokens.input + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0),
        output: tokens.output + (tokens.reasoning ?? 0),
        stopReason: Option.fromUndefinedOr(reason),
      }),
    ];
  }

  return Option.match(errorOf(line), {
    onNone: () => [],
    onSome: ({ error }) => [
      HarnessEvent.Failed({
        reason:
          error.message === undefined
            ? error.type
            : `${error.type}: ${error.message}`,
      }),
      HarnessEvent.Settled({ stopReason: Option.some(error.type) }),
    ],
  });
};

/** The flags every run shares: a private server, JSON events, approvals, the model. */
const headless = (model: string) => [
  "run",
  "--standalone",
  "--format",
  "json",
  "--auto",
  "-m",
  model,
];

export const opencode: HarnessDriver = {
  files: () => [],
  harness: "opencode",
  parse,
  resume: ({ model, prompt, session }) => [
    "opencode",
    ...headless(model),
    "-s",
    session,
    prompt,
  ],
  start: ({ brief, model }) => ["opencode", ...headless(model), brief],
};
