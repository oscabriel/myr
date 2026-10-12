// Nothing here touches the terminal, so the CLI loads OpenTUI only when `--tui` opens it.
// A choice other than the decision's default waits for `y`: the default is the safe one.
import type { Decide } from "@repo/protocol/contracts";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision, Today } from "@repo/protocol/domain/decision";
import type { DecisionId, ProjectName } from "@repo/protocol/ids";
import { Array as Arr, DateTime, Option, Order } from "effect";

export type DecideCall = Omit<typeof Decide.payloadSchema.Type, "note">;

export interface TodayViewState {
  readonly today: Today;
  readonly cursor: number;
  readonly confirming: Option.Option<DecideCall>;
  readonly notice: readonly string[];
}

export interface Step {
  readonly state: TodayViewState;
  readonly call: Option.Option<DecideCall>;
  readonly quit: boolean;
}

/** Ids are minted per project, so the project comes first. */
export const placeOf = (project: ProjectName, id: DecisionId) =>
  `${project}/${id}`;

const keyOf = ({ id, project }: Decision) => placeOf(project, id);

const expiryOrder: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ project }: Decision) => project),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

/** Ids are minted per project: where an id is named `n` times, its `n` soonest-expiring decisions are meant. */
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

export const soonIn = (today: Today) => {
  const soon = expiringSoon(today);

  return (decision: Decision) => soon.has(keyOf(decision));
};

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

export interface ChoiceKey {
  readonly choice: Choice;
  readonly key: string;
}

const yesOrNo: readonly ChoiceKey[] = [
  { choice: "accept", key: "a" },
  { choice: "decline", key: "d" },
];

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

export const start = (today: Today): TodayViewState => ({
  confirming: Option.none(),
  cursor: 0,
  notice: [],
  today,
});

export const current = (state: TodayViewState): Option.Option<Decision> =>
  Arr.get(inOrder(state.today), state.cursor);

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

/** The decision taken has left the list, so the same cursor lands on the next one. */
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
