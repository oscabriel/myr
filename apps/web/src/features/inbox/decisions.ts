import { Today } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { DecisionId, ProjectName } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { Refusal } from "@repo/protocol/refusal";
import { Array as Arr, Cause, DateTime, Option, Order, Schema } from "effect";

import { decisionKey } from "../decision/subject.ts";

/** What a read of the reader's decisions came back as: the decision page reads it, and the inbox's live decisions. */
export const TodayRead = Schema.TaggedUnion({
  Read: { today: Today },
  Refused: { refusal: Refusal },
  SignedOut: {},
  Unreachable: {},
});

export type TodayRead = typeof TodayRead.Type;

const isRefusal = Schema.is(Refusal);

const isUnauthenticated = Schema.is(Unauthenticated);

export const isSignedOut = (cause: Cause.Cause<unknown>) =>
  Option.exists(Cause.findErrorOption(cause), isUnauthenticated);

export const readOfCause = (cause: Cause.Cause<unknown>): TodayRead => {
  const error = Cause.findErrorOption(cause);

  if (Option.isSome(error) && isRefusal(error.value)) {
    return TodayRead.cases.Refused.make({ refusal: error.value });
  }

  return isSignedOut(cause)
    ? TodayRead.cases.SignedOut.make({})
    : TodayRead.cases.Unreachable.make({});
};

export const expiryOrder: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ project }: Decision) => project),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

/**
 * Ids are minted per project, so a Today across projects may hold two decisions
 * with one id; where an id is named `n` times, the `n` of its decisions that
 * expire first are the ones meant.
 */
export const expiringSoon = (today: Today): ReadonlySet<string> => {
  const named = Arr.groupBy(today.expiringSoon, (id) => id);
  const byExpiry = Arr.sort(today.decisions, expiryOrder);

  return new Set(
    Object.entries(named).flatMap(([id, times]) =>
      byExpiry
        .filter((decision) => decision.id === id)
        .slice(0, times.length)
        .map(decisionKey)
    )
  );
};

export const orderDecisions = (today: Today): readonly Decision[] => {
  const soon = expiringSoon(today);

  return Arr.sort(
    today.decisions,
    Order.combine(
      Order.mapInput(
        Order.Boolean,
        (decision: Decision) => !soon.has(decisionKey(decision))
      ),
      expiryOrder
    )
  );
};

export const findDecision = (
  today: Today,
  project: ProjectName,
  id: DecisionId
): Option.Option<{ readonly decision: Decision; readonly soon: boolean }> => {
  const soon = expiringSoon(today);

  return Arr.findFirst(
    today.decisions,
    (decision) => decision.project === project && decision.id === id
  ).pipe(
    Option.map((decision) => ({
      decision,
      soon: soon.has(decisionKey(decision)),
    }))
  );
};
