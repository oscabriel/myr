/**
 * Today in the terminal, as pure state: which decision the cursor is on,
 * which choice waits for a confirmation, and what the last choice came to.
 * `reduce` turns one key into the next state and, when the decider has
 * chosen, the `decide` call to make; the screen and the platform are the
 * runner's (`run.ts`). Nothing here touches the terminal, so the CLI loads
 * OpenTUI only when `--tui` opens it.
 *
 * The decisions are in the order a decider takes them, as the web's Today
 * lists them: those expiring within the day first, then by expiry. Each
 * subject offers its own two choices, each on its first letter: a stray
 * push is adopted (`a`) or reverted (`r`), anything else accepted (`a`) or
 * declined (`d`). A decision's default is taken at once; any other choice
 * waits for `y` (or Enter), since the default is the safe one.
 */
import type { Decide } from "@repo/protocol/contracts";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision, Today } from "@repo/protocol/domain/decision";
import type { DecisionId, ProjectName } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Option, Order } from "effect";

/** A choice on its way to `decide`: the contract's payload, without a note. */
export type DecideCall = Omit<typeof Decide.payloadSchema.Type, "note">;

export interface TodayViewState {
  readonly today: Today;
  /** The decision the decider is on, as an index into `inOrder(today)`. */
  readonly cursor: number;
  /** A choice other than the default, waiting for `y` before it is sent. */
  readonly confirming: Option.Option<DecideCall>;
  /** What the last choice came to, one line each: decided, or the refusal. */
  readonly notice: readonly string[];
}

/** What one key did: the next state, the call to make, and whether to close. */
export interface Step {
  readonly state: TodayViewState;
  readonly call: Option.Option<DecideCall>;
  readonly quit: boolean;
}

/**
 * A decision's place in a Today that may hold several projects, as the
 * screen names it: ids are minted per project, so the project comes first.
 */
export const placeOf = (project: ProjectName, id: DecisionId) =>
  `${project}/${id}`;

const keyOf = ({ id, project }: Decision) => placeOf(project, id);

/** Soonest to expire first, then oldest, then by project and id: one order every time. */
const expiryOrder: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ project }: Decision) => project),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

/**
 * The decisions `today.expiringSoon` names. Ids are minted per project, so
 * where an id is named `n` times, the `n` of its decisions that expire first
 * are the ones meant (the web's Today reads them the same way).
 */
const expiringSoon = (today: Today): ReadonlySet<string> => {
  const named = Arr.groupBy(today.expiringSoon, (id) => id);
  const byExpiry = Arr.sort(today.decisions, expiryOrder);

  return new Set(
    Object.entries(named).flatMap(([id, times]) =>
      byExpiry
        .filter((decision) => decision.id === id)
        .slice(0, times.length)
        .map(keyOf)
    )
  );
};

/** Whether a decision is one of those `today.expiringSoon` names. */
export const soonIn = (today: Today) => {
  const soon = expiringSoon(today);

  return (decision: Decision) => soon.has(keyOf(decision));
};

/** Today's decisions in the order a decider takes them: expiring soon first, then by expiry. */
export const inOrder = (today: Today): readonly Decision[] => {
  const isSoon = soonIn(today);

  return Arr.sort(
    today.decisions,
    Order.combine(
      Order.mapInput(Order.Boolean, (decision: Decision) => !isSoon(decision)),
      expiryOrder
    )
  );
};

/** A choice, and the key that makes it. */
export interface ChoiceKey {
  readonly choice: Choice;
  readonly key: string;
}

const yesOrNo: readonly ChoiceKey[] = [
  { choice: "accept", key: "a" },
  { choice: "decline", key: "d" },
];

/** The choices a decision's subject offers, each with its key. */
export const choicesFor = (decision: Decision): readonly ChoiceKey[] =>
  DecisionSubject.match(decision.subject, {
    Finish: () => yesOrNo,
    OpenProposal: () => yesOrNo,
    PostureChange: () => yesOrNo,
    ProxyWidened: () => yesOrNo,
    RaiseRatchet: () => yesOrNo,
    SecretInTree: () => yesOrNo,
    StrayPush: (): readonly ChoiceKey[] => [
      { choice: "adopt", key: "a" },
      { choice: "revert", key: "r" },
    ],
    Vouch: () => yesOrNo,
    Waiver: () => yesOrNo,
  });

/** Today as the decider first sees it: on the first decision, nothing chosen. */
export const start = (today: Today): TodayViewState => ({
  confirming: Option.none(),
  cursor: 0,
  notice: [],
  today,
});

/** The decision the cursor is on, if Today holds any. */
export const current = (state: TodayViewState): Option.Option<Decision> =>
  Arr.get(inOrder(state.today), state.cursor);

/** A cursor kept on a decision: never past the last one, never below the first. */
const clamp = (cursor: number, today: Today) =>
  Math.max(0, Math.min(cursor, today.decisions.length - 1));

const stay = (state: TodayViewState): Step => ({
  call: Option.none(),
  quit: false,
  state,
});

const send = (state: TodayViewState, call: DecideCall): Step => ({
  call: Option.some(call),
  quit: false,
  state: { ...state, confirming: Option.none() },
});

const moveBy = (state: TodayViewState, by: number): Step =>
  stay({
    ...state,
    confirming: Option.none(),
    cursor: clamp(state.cursor + by, state.today),
  });

/**
 * The choice `key` makes on the decision the cursor is on: its default goes
 * at once, any other waits for a confirmation. A key the subject doesn't
 * offer, or a decision already decided, does nothing.
 */
const choose = (state: TodayViewState, key: string): Step =>
  Option.match(current(state), {
    onNone: () => stay(state),
    onSome: (decision) =>
      Option.match(
        Arr.findFirst(choicesFor(decision), (each) => each.key === key),
        {
          onNone: () => stay(state),
          onSome: ({ choice }) => {
            if (decision.decided !== undefined) {
              return stay(state);
            }

            const call = {
              choice,
              decision: decision.id,
              project: decision.project,
            };

            return choice === decision.default
              ? send(state, call)
              : stay({ ...state, confirming: Option.some(call) });
          },
        }
      ),
  });

const UP = new Set(["up", "k"]);

const DOWN = new Set(["down", "j"]);

const QUIT = new Set(["q", "ctrl+c", "escape"]);

const CONFIRM = new Set(["y", "return", "enter"]);

const CANCEL = new Set(["n", "escape"]);

/** One key, with no confirmation waiting. */
const free = (state: TodayViewState, key: string): Step => {
  if (UP.has(key)) {
    return moveBy(state, -1);
  }

  if (DOWN.has(key)) {
    return moveBy(state, 1);
  }

  if (QUIT.has(key)) {
    return { call: Option.none(), quit: true, state };
  }

  return choose(state, key);
};

/**
 * One key, by its name (`up`, `d`, `return`, `ctrl+c`): moves the cursor
 * (arrows, `j`/`k`), makes a choice, confirms (`y`, Enter) or cancels (`n`,
 * Escape) a choice waiting, or closes Today (`q`, Escape, Ctrl+C). Any other
 * key while a choice waits cancels it, then does what it does.
 */
export const reduce = (state: TodayViewState, key: string): Step =>
  Option.match(state.confirming, {
    onNone: () => free(state, key),
    onSome: (waiting) => {
      if (CONFIRM.has(key)) {
        return send(state, waiting);
      }

      const cancelled = { ...state, confirming: Option.none() };

      return CANCEL.has(key) ? stay(cancelled) : free(cancelled, key);
    },
  });

/**
 * Today again after a choice: the platform's newer page, the cursor on the
 * same place (the decision taken has left it, so the next one is there),
 * and what the choice came to.
 */
export const refreshed = (
  state: TodayViewState,
  today: Today,
  notice: readonly string[]
): TodayViewState => ({
  confirming: Option.none(),
  cursor: clamp(state.cursor, today),
  notice,
  today,
});
