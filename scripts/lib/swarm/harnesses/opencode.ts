// `--standalone` runs a private server in the contributor's env, not the machine's
// background service. The last step prints no `step_finish` before the process
// exits (seen on 2.0.7), so the run settles on exit; an `error` event settles it at once.
import { Option, Schema } from "effect";

import { HarnessEvent, lineAs, Tokens } from "./event.ts";
import type { HarnessDriver } from "./event.ts";

const StepStart = Schema.Struct({
  sessionID: Schema.NonEmptyString,
  type: Schema.Literal("step_start"),
});

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
