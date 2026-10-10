/**
 * What Today's page reads, in a module with no view of its own: a route's
 * loader runs before its page's view loads, so the route reaches these
 * without carrying the page.
 *
 * - `TodayRead`: the reader's Today, or why there is none (a refusal, no
 *   session, no answer from the platform), as the loader sends it.
 * - `readToday`: that read, made with whatever `Client` the caller gives
 *   (the server's, carrying the reader's own session).
 * - The order a decider takes decisions in: due within the day first, then
 *   by expiry.
 */
import { Client } from "@repo/protocol/contracts";
import { Today } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { DecisionId, ProjectName } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { Refusal } from "@repo/protocol/refusal";
import {
  Array as Arr,
  Cause,
  DateTime,
  Effect,
  Exit,
  Option,
  Order,
  Schema,
} from "effect";

import { decisionKey } from "../decision/subject.ts";

/** What the page read for its reader: their Today, or why there is none. */
export const TodayRead = Schema.TaggedUnion({
  Read: { today: Today },
  Refused: { refusal: Refusal },
  SignedOut: {},
  Unreachable: {},
});

export type TodayRead = typeof TodayRead.Type;

/** What Today's loader sends: the read, and the instant it was made. */
export const TodayPageData = Schema.Struct({
  now: Schema.DateTimeUtcFromString,
  read: TodayRead,
});

export type TodayPageData = typeof TodayPageData.Type;

const isRefusal = Schema.is(Refusal);

const isUnauthenticated = Schema.is(Unauthenticated);

/** Whether a read failed because its reader is not signed in. */
export const isSignedOut = (cause: Cause.Cause<unknown>) =>
  Option.exists(Cause.findErrorOption(cause), isUnauthenticated);

/** A failed read of Today, as the page says it. */
export const readOfCause = (cause: Cause.Cause<unknown>): TodayRead => {
  const error = Cause.findErrorOption(cause);

  if (Option.isSome(error) && isRefusal(error.value)) {
    return TodayRead.cases.Refused.make({ refusal: error.value });
  }

  return isSignedOut(cause)
    ? TodayRead.cases.SignedOut.make({})
    : TodayRead.cases.Unreachable.make({});
};

/** Soonest to expire first, then oldest, then by project and id: one order every time. */
export const expiryOrder: Order.Order<Decision> = Order.combineAll([
  Order.mapInput(DateTime.Order, ({ expiresAt }: Decision) => expiresAt),
  Order.mapInput(DateTime.Order, ({ openedAt }: Decision) => openedAt),
  Order.mapInput(Order.String, ({ project }: Decision) => project),
  Order.mapInput(Order.String, ({ id }: Decision) => id),
]);

/**
 * The decisions `today.expiringSoon` names. Ids are minted per project, so a
 * Today across projects may hold two decisions with one id; where an id is
 * named `n` times, the `n` of its decisions that expire first are the ones
 * meant (a decision that expires within the day expires before any that
 * does not).
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

/** Today's decisions in the order a decider takes them: expiring soon first, then by expiry. */
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

/** Where one decision stands on Today: listed (and whether it expires soon), or not there. */
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

/** The reader's Today, or why there is none, encoded for the page. */
export const readToday = ({ project }: { readonly project?: ProjectName }) =>
  Effect.gen(function* () {
    const client = yield* Client;

    const read = yield* Effect.exit(
      client.today(project === undefined ? {} : { project })
    );

    return yield* Schema.encodeEffect(TodayPageData)({
      now: yield* DateTime.now,
      read: Exit.match(read, {
        onFailure: readOfCause,
        onSuccess: (today) => TodayRead.cases.Read.make({ today }),
      }),
    });
  });
