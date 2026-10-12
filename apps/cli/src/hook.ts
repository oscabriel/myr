// The gateway is the authority, so the hook fails open: on anything it cannot judge it prints `{}` and exits 0.
import { HookEvent } from "@repo/agent-kit/hook-events";
import { Brand } from "@repo/brand";
import {
  Cause,
  Console,
  Effect,
  Option,
  Runtime,
  Schema,
  Stdio,
  Stream,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { decideHook } from "./hook/decide.ts";
import type { HookOutput } from "./hook/decide.ts";
import { gatherFacts } from "./hook/facts.ts";
import { decodeHookInput } from "./hook/input.ts";
import type { HookInput } from "./hook/input.ts";
import { PushCheck, PushCheckChild } from "./hook/push-check.ts";
import type { PushCheckFailed } from "./hook/push-check.ts";
import { loadSession, saveSession } from "./hook/session.ts";
import type { SessionState } from "./hook/session.ts";
import { Output } from "./output.ts";

const EVENTS = HookEvent.literals.join(", ");

export class HookUsage extends Schema.TaggedError<HookUsage>()("HookUsage", {
  event: Schema.String,
}) {
  override readonly [Runtime.errorExitCode] = 2;
  override readonly [Runtime.errorReported] = false;

  override get message() {
    return `hook: no event ${this.event}; the events are ${EVENTS}`;
  }
}

const decodeEvent = Schema.decodeUnknownOption(HookEvent);

const stdinText = Effect.flatMap(Stdio.Stdio, ({ stdin }) =>
  stdin.pipe(Stream.decodeText(), Stream.mkString)
);

const pushCheck = Effect.flatMap(
  Effect.serviceOption(PushCheck),
  Option.match({
    onNone: () => Effect.provide(Effect.service(PushCheck), PushCheckChild),
    onSome: Effect.succeed,
  })
);

/** `pre-tool-use` never asks the platform, so an edit never waits on the network. */
const sessionFacts = (event: HookEvent, input: HookInput) =>
  Effect.gen(function* () {
    const kept = yield* loadSession(input.session_id);

    if (
      Option.isSome(kept) &&
      (kept.value.claim !== undefined || event === "pre-tool-use")
    ) {
      return kept.value;
    }

    const gathered = yield* gatherFacts(input.cwd);

    yield* saveSession(input.session_id, gathered).pipe(
      Effect.catchTag("SessionUnsaved", (unsaved) =>
        Output.use((output) => output.note(unsaved.message))
      )
    );

    return gathered;
  });

const refusalsFor = (event: HookEvent, state: SessionState) => {
  const { claim } = state;

  return event === "stop" && claim !== undefined
    ? Effect.flatMap(pushCheck, (check) => check.run(state.root, claim.base))
    : Effect.succeed([]);
};

const answer = (event: HookEvent, input: HookInput) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const state = yield* sessionFacts(event, input);

    const decision = decideHook(event, input, {
      claim: Option.fromUndefinedOr(state.claim),
      holds: state.holds,
      judge: state.judge,
      refusals: yield* refusalsFor(event, state),
      root: state.root,
    });

    const counted =
      decision.holds === state.holds
        ? true
        : yield* saveSession(input.session_id, {
            ...state,
            holds: decision.holds,
          }).pipe(
            Effect.as(true),
            Effect.catchTag("SessionUnsaved", (unsaved) =>
              Effect.as(output.note(unsaved.message), false)
            )
          );

    // A hold the session cannot count could never reach the cap: allow.
    if (!counted && decision.holds > state.holds) {
      yield* output.note(
        `${event}: this hold could not be counted, so the agent may stop; ${Brand.cli} check still refuses its work`
      );

      return {};
    }

    // Why the session has no claim says more than the policy's "no claim".
    const why = Option.orElse(
      Option.fromUndefinedOr(state.why),
      () => decision.note
    );

    if (Option.isSome(why)) {
      yield* output.note(`${event}: ${why.value}`);
    }

    return decision.output;
  });

const print = (json: boolean, output: HookOutput) =>
  Console.log(json ? JSON.stringify(output) : JSON.stringify(output, null, 2));

const failOpen = (json: boolean, why: string) =>
  Effect.andThen(
    Output.use((output) => output.note(`hook: ${why}; allowing`)),
    print(json, {})
  );

const run = (name: string, json: boolean) =>
  Effect.gen(function* () {
    const event = decodeEvent(name);

    if (Option.isNone(event)) {
      return yield* new HookUsage({ event: name });
    }

    const input = yield* Effect.flatMap(stdinText, decodeHookInput).pipe(
      Effect.option
    );

    if (Option.isNone(input)) {
      return yield* failOpen(
        json,
        "could not read the harness's JSON on stdin"
      );
    }

    return yield* answer(event.value, input.value).pipe(
      Effect.flatMap((output) => print(json, output)),
      Effect.catchTag("PushCheckFailed", (failed: PushCheckFailed) =>
        failOpen(json, failed.message)
      ),
      // Any defect of the hook's own: the gateway still judges the push.
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          failOpen(json, String(Cause.squash(cause)).split("\n")[0] ?? "")
      )
    );
  });

export const hook = Command.make(
  "hook",
  {
    event: Argument.String("event").pipe(
      Argument.withDescription(`The harness event: ${EVENTS}.`)
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print the answer as one line of JSON, as a harness reads it; without it, indented."
      )
    ),
  },
  ({ event, json }) => run(event, json)
).pipe(
  Command.withDescription(
    "Answer a harness hook (session-start, pre-tool-use, stop) with the gate's policy."
  )
);
