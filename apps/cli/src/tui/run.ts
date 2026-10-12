import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import type { Decision } from "@repo/protocol/domain/decision";
import type { ProjectName } from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import type { Scope } from "effect";
import {
  Array as Arr,
  Context,
  Effect,
  Option,
  Predicate,
  Runtime,
  Schema,
  Stdio,
} from "effect";

import { CurrentMode, Policy } from "../policy.ts";
import { placeOf, reduce, refreshed, start } from "./today.ts";
import type { DecideCall, TodayViewState } from "./today.ts";

const instead = `${Brand.cli} today --json`;

export class TuiRefused extends Schema.TaggedError<TuiRefused>()("TuiRefused", {
  next: Schema.NonEmptyString.pipe(
    Schema.withConstructorDefault(Effect.succeed(instead))
  ),
  reason: Schema.String,
}) {
  override readonly [Runtime.errorExitCode] = 2;

  override get message() {
    return `${Brand.cli} today --tui needs a person at a terminal, but ${this.reason}: run ${this.next} instead`;
  }
}

export const causeText = (cause: unknown) =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)
    ? cause.message
    : String(cause);

export interface Screen {
  readonly show: (state: TodayViewState) => Effect.Effect<void>;
  readonly key: Effect.Effect<string>;
  readonly forget: Effect.Effect<void>;
}

/** Opens the terminal through OpenTUI, loading it only now. */
const terminal: Effect.Effect<Screen, TuiRefused, Scope.Scope> =
  Effect.tryPromise({
    catch: (cause) =>
      new TuiRefused({
        reason: `the terminal could not be opened (${causeText(cause)})`,
      }),
    try: () => import("./screen.ts"),
  }).pipe(Effect.flatMap(({ openTerminal }) => openTerminal));

export const OpenScreen = Context.Reference<
  Effect.Effect<Screen, TuiRefused, Scope.Scope>
>("cli/tui/OpenScreen", { defaultValue: () => terminal });

const invocation = Effect.flatMap(
  Effect.serviceOption(Policy),
  Option.match({
    onNone: () => Effect.provide(Effect.service(Policy), CurrentMode),
    onSome: Effect.succeed,
  })
);

const aPersonAtATerminal = Effect.gen(function* () {
  const { mode, reason } = yield* invocation;

  const typing = yield* Effect.flatMap(
    Stdio.Stdio,
    (stdio) => stdio.stdinIsTerminal
  );

  // The policy's reason first: an agent at a terminal is still an agent.
  const reasons = [
    ...(mode === "human" ? [] : [reason]),
    ...(typing ? [] : ["stdin is not a terminal"]),
  ];

  yield* Option.match(Arr.head(reasons), {
    onNone: () => Effect.void,
    onSome: (why) => Effect.fail(new TuiRefused({ reason: why })),
  });
});

const isRefusal = Schema.is(Refusal);

export const payloadFor = (project: Option.Option<ProjectName>) =>
  Option.match(project, {
    onNone: () => ({}),
    onSome: (name) => ({ project: name }),
  });

const decidedLine = (call: DecideCall, decision: Decision) =>
  `Decided: ${decision.decided?.choice ?? call.choice} on ${placeOf(call.project, call.decision)}`;

export const runTodayTui = (input: {
  readonly project: Option.Option<ProjectName>;
}) =>
  Effect.gen(function* () {
    yield* aPersonAtATerminal;

    const client = yield* Client;

    const payload = payloadFor(input.project);

    const first = start(yield* client.today(payload));

    const decide = (screen: Screen, state: TodayViewState, call: DecideCall) =>
      Effect.gen(function* () {
        yield* screen.show({
          ...state,
          notice: [
            `Sending ${call.choice} on ${placeOf(call.project, call.decision)}…`,
          ],
        });

        const notice = yield* client.decide(call).pipe(
          Effect.map(({ decision }) => [decidedLine(call, decision)]),
          Effect.catchIf(isRefusal, (refusal) =>
            Effect.succeed(explain([refusal]))
          )
        );

        const after = refreshed(state, yield* client.today(payload), notice);

        yield* screen.show(after);
        yield* screen.forget;

        return after;
      });

    const session = (
      screen: Screen,
      state: TodayViewState
    ): Effect.Effect<void, Effect.Error<ReturnType<typeof decide>>> =>
      Effect.flatMap(screen.key, (key) => {
        const step = reduce(state, key);

        if (step.quit) {
          return Effect.void;
        }

        return screen.show(step.state).pipe(
          Effect.andThen(
            Option.match(step.call, {
              onNone: () => Effect.succeed(step.state),
              onSome: (call) => decide(screen, step.state, call),
            })
          ),
          Effect.flatMap((next) => session(screen, next))
        );
      });

    const open = yield* OpenScreen;

    yield* Effect.scoped(
      Effect.gen(function* () {
        const screen = yield* open;

        yield* screen.show(first);
        yield* session(screen, first);
      })
    );
  });
