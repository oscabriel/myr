/**
 * `<cli> hook <event> --json`: the one command behind every harness hook in
 * Claude Code's format (Claude Code itself, and Cursor and Copilot CLI, which
 * read it). It reads the harness's JSON on stdin, gathers the session's facts
 * once (cached per session), asks `decideHook`, and prints the decision as
 * the one JSON document on stdout.
 *
 * Hooks are early feedback; the gateway is the authority. So the hook fails
 * open: without a claim, without the platform, with input it cannot read, or
 * on any failure of its own, it prints `{}` (go on), says why on stderr, and
 * exits 0. Only a wrong event name, a mistake in the hook's own config, is a
 * usage error (exit 2).
 */
import { HookEvent } from "@repo/agent-kit/hook-events";
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

/**
 * The hook was called with an event it does not answer: its config is
 * wrong. A defect, so the program's exit-1 mapping of failures leaves its
 * exit code (2, a usage error) alone; its usage was printed already.
 */
export class HookUsage extends Schema.TaggedError<HookUsage>()("HookUsage", {
  event: Schema.String,
}) {
  override readonly [Runtime.errorExitCode] = 2;
  override readonly [Runtime.errorReported] = false;
}

const EVENTS = HookEvent.literals.join(", ");

const decodeEvent = Schema.decodeUnknownOption(HookEvent);

/** The whole of stdin, as text. */
const stdinText = Effect.flatMap(Stdio.Stdio, ({ stdin }) =>
  stdin.pipe(Stream.decodeText(), Stream.mkString)
);

/** The PushCheck the caller provided, or this CLI run again as a child. */
const pushCheck = Effect.flatMap(
  Effect.serviceOption(PushCheck),
  Option.match({
    onNone: () => Effect.provide(Effect.service(PushCheck), PushCheckChild),
    onSome: Effect.succeed,
  })
);

/**
 * The session's facts: kept from an earlier event, else gathered and kept.
 * A claim, once found, holds for the session, so `pre-tool-use` never asks
 * the platform again. Without one, `session-start` and `stop` look again
 * (once a turn), so a claim the agent takes mid-session is found at the end
 * of that turn; `pre-tool-use` never does, so an edit never waits on the
 * network.
 */
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

/** Stop asks the local check; nothing else does, and only with a claim. */
const refusalsFor = (event: HookEvent, state: SessionState) =>
  event === "stop" && state.claim !== undefined
    ? Effect.flatMap(pushCheck, (check) => check.run(state.root))
    : Effect.succeed([]);

/** Answers one event: the decision's JSON, with its note on stderr. */
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

    if (decision.holds !== state.holds) {
      yield* saveSession(input.session_id, {
        ...state,
        holds: decision.holds,
      }).pipe(
        Effect.catchTag("SessionUnsaved", (unsaved) =>
          output.note(unsaved.message)
        )
      );
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

/** The answer on stdout: one line of JSON, or indented for a person. */
const print = (json: boolean, output: HookOutput) =>
  Console.log(json ? JSON.stringify(output) : JSON.stringify(output, null, 2));

/** Says why the hook allows, on stderr, and lets the harness go on. */
const failOpen = (json: boolean, why: string) =>
  Effect.andThen(
    Output.use((output) => output.note(`hook: ${why}; allowing`)),
    print(json, {})
  );

const run = (name: string, json: boolean) =>
  Effect.gen(function* () {
    const event = decodeEvent(name);

    if (Option.isNone(event)) {
      yield* Output.use((output) =>
        output.note(`hook: no event ${name}; the events are ${EVENTS}`)
      );

      return yield* Effect.die(new HookUsage({ event: name }));
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
