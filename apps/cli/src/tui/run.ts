/**
 * `<cli> today --tui`: Today full-screen, for a person at a terminal. It
 * reads Today and takes decisions through the same `today` and `decide`
 * contracts as every other surface, over the CLI's remote client: no second
 * data path. Under an agent, in a script, or without a terminal to read
 * keys from, it never opens (nor prompts): it refuses and points to
 * `today --json`.
 *
 * The screen is a port: the terminal through OpenTUI (`screen.ts`, loaded
 * only here, so no other command loads OpenTUI or its native library), or
 * whatever a test gives `OpenScreen`.
 */
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

import { Policy } from "../policy.ts";
import { placeOf, reduce, refreshed, start } from "./today.ts";
import type { DecideCall, TodayViewState } from "./today.ts";

/** What a script or an agent runs for Today instead. */
const instead = `${Brand.cli} today --json`;

/**
 * `--tui` was asked for where no person can work it: under an agent, in a
 * script, or without a terminal. A usage error (exit 2) on the CLI's side,
 * not one of the platform's refusals: nothing was called. Its `next` is the
 * command that reads the same Today as one JSON document.
 */
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

/** Why something failed, in a few words: its message, or itself. */
export const causeText = (cause: unknown) =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)
    ? cause.message
    : String(cause);

/** A screen Today is drawn on and keys are read from. */
export interface Screen {
  /** Draws a state in place of the one before. */
  readonly show: (state: TodayViewState) => Effect.Effect<void>;
  /** The next key the person presses, by name: `down`, `d`, `return`, `ctrl+c`. */
  readonly key: Effect.Effect<string>;
  /** Forgets the keys pressed and not read yet: those pressed while a choice was on its way. */
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

/** How `--tui` opens its screen: the terminal, unless a test gives another. */
export const OpenScreen = Context.Reference<
  Effect.Effect<Screen, TuiRefused, Scope.Scope>
>("cli/tui/OpenScreen", { defaultValue: () => terminal });

/**
 * A person at a terminal, by the CLI's invocation policy, who can type
 * there too: anything else is refused before the platform is called.
 */
const aPersonAtATerminal = Effect.gen(function* () {
  const { mode, reason } = yield* Policy;

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

/** The `today` contract's payload, for one project or every one. */
export const payloadFor = (project: Option.Option<ProjectName>) =>
  Option.match(project, {
    onNone: () => ({}),
    onSome: (name) => ({ project: name }),
  });

/** What a choice the platform took came to, in one line. */
const decidedLine = (call: DecideCall, decision: Decision) =>
  `Decided: ${decision.decided?.choice ?? call.choice} on ${placeOf(call.project, call.decision)}`;

/**
 * `runTodayTui`: Today full-screen until the decider closes it. Arrows move,
 * a choice key decides through `decide` (a choice other than the default
 * after a confirmation), and each choice is followed by Today read again.
 * A refusal of a choice shows on the screen in `explain`'s words; a refusal
 * of Today itself, or a platform out of reach, closes the screen and fails.
 */
export const runTodayTui = (input: {
  readonly project: Option.Option<ProjectName>;
}) =>
  Effect.gen(function* () {
    yield* aPersonAtATerminal;

    const client = yield* Client;

    const payload = payloadFor(input.project);

    const first = start(yield* client.today(payload));

    /** Sends a choice, then reads Today again, and says what it came to. */
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

    /** One key, then the next, until the decider closes Today. */
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
