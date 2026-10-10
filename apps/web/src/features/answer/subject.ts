/**
 * What an ask's page and its answer's page read beside their subject, and
 * the plain readings over it:
 *
 * - the project's events (`watch`, replayed from the first), kept to the
 *   ones about the asks the page draws: the ask, what it waits on, and its
 *   family. The fold over them (`askStates`) says who holds each ask, its
 *   rounds and whether it landed, with no contract of its own;
 * - a family member's parent (`showAsk`), whose stored children count the
 *   family, since a listing drops the ones that landed;
 * - what a verdict holds, so the gate's strip draws a stage the answer
 *   never needed as not needed.
 *
 * A read beside the subject that fails leaves its part out; it never fails
 * the page.
 */
import { Client } from "@repo/protocol/contracts";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { AskId, CommitSha, ProjectName } from "@repo/protocol/ids";
import { Effect, Option, Stream } from "effect";

import { lastSeq } from "../shared/ask-progress.ts";
import type { AskProgress, Round } from "../shared/ask-progress.ts";
import type { StageHolds } from "../shared/outcome.tsx";

/** The ask an event is about: one, or none. */
const askOf = (event: ProjectEvent): readonly AskId[] =>
  ProjectEvent.match(event, {
    AskClosed: ({ ask }) => [ask],
    AskOpened: ({ ask }) => [ask.ask],
    Claimed: ({ ask }) => [ask],
    Decided: () => [],
    Judged: ({ ask }) => [ask],
    Landed: () => [],
    Lapsed: ({ ask }) => [ask],
    LedgerAppended: () => [],
    ProposalDrafted: () => [],
    ProposalOpened: () => [],
    Pushed: ({ ask }) => [ask],
    Released: ({ ask }) => [ask],
    Warned: ({ ask }) => [ask],
  });

/** The events about `asks`, in the order given. */
export const eventsAbout = (
  events: readonly ProjectEvent[],
  asks: ReadonlySet<AskId>
): readonly ProjectEvent[] =>
  events.filter((event) => askOf(event).some((about) => asks.has(about)));

/**
 * The delete child among a family parent's stored children: the one named
 * for the parent, as the platform names it when it splits a migrate ask.
 */
export const deleteChildOf = (parent: Ask): AskId | undefined =>
  parent.blockedBy.find((child) => child === `${parent.id}-delete`);

/** The parent of the family `ask` is in: the one read for it, or the ask itself when it heads one. */
export const familyHead = (ask: Ask, parent: Ask | undefined) =>
  parent ?? (deleteChildOf(ask) === undefined ? undefined : ask);

/** Every ask whose events the page needs: the ask, what it waits on, and its family. */
export const asksAround = (
  ask: Ask,
  parent: Ask | undefined
): ReadonlySet<AskId> =>
  new Set([
    ask.id,
    ...ask.blockedBy,
    ...(parent === undefined ? [] : [parent.id, ...parent.blockedBy]),
  ]);

/** The project's events from the first; none when they cannot be read. */
export const readEvents = (project: ProjectName) =>
  Effect.gen(function* () {
    const client = yield* Client;

    const events: readonly ProjectEvent[] = yield* Stream.runCollect(
      client.watch({ project, since: 0 })
    ).pipe(Effect.orElseSucceed((): readonly ProjectEvent[] => []));

    return events;
  });

/** The parent ask of a family member; none for an ask in no family, or one the platform no longer finds. */
export const readParent = (ask: Ask) =>
  Effect.gen(function* () {
    if (ask.parent === undefined) {
      return Option.none<Ask>();
    }

    const client = yield* Client;

    return yield* client
      .showAsk({ ask: ask.parent, project: ask.project })
      .pipe(
        Effect.map(({ ask: parent }) => Option.some(parent)),
        Effect.orElseSucceed(() => Option.none<Ask>())
      );
  });

/** What a page carries of the events: those about its asks, and the last number of all of them. */
export const keptEvents = (
  events: readonly ProjectEvent[],
  ask: Ask,
  parent: Ask | undefined
) => ({
  events: eventsAbout(events, asksAround(ask, parent)),
  lastSeq: lastSeq(events),
});

/** Whether an outcome waited on a person: a decision, or a decider's finish. */
const waitedOnPerson = Outcome.isAnyOf(["AwaitingDecision", "AwaitingFinish"]);

/**
 * What a verdict holds beyond its stage: whether a decider took part (the
 * landing's `Decided-by`, or a round of the same answer that waited on one)
 * and whether held-back checks judged it.
 */
export const holdsOf = (
  verdict: Verdict,
  landing: LandingView | undefined,
  rounds: readonly Round[]
): StageHolds => ({
  decided:
    (landing?.credits.some(({ role }) => role === "Decided-by") ?? false) ||
    rounds.some(
      ({ head, outcome }) => head === verdict.head && waitedOnPerson(outcome)
    ),
  heldBack: verdict.heldBack.length > 0,
});

/** Which round the answer at `head` is, of how many: the last round judged at that head. */
export const roundOf = (
  rounds: readonly Round[],
  head: CommitSha
): { readonly number: number; readonly of: number } | undefined => {
  const index = rounds.findLastIndex((round) => round.head === head);

  return index === -1 ? undefined : { number: index + 1, of: rounds.length };
};

/**
 * Each round with the last word on it: a round's own event says what the
 * gate said when it judged the push (often that it was still checking),
 * so the verdict on that head, and the landing that closed the ask, speak
 * for it once they came.
 */
export const roundsAsTheyStand = (
  progress: AskProgress | undefined,
  verdict: Verdict | undefined
): readonly Round[] => {
  const rounds = progress?.rounds ?? [];
  const landed = progress?.landed;
  const last = rounds.length - 1;

  const latestAt =
    verdict === undefined
      ? -1
      : rounds.findLastIndex(({ head }) => head === verdict.head);

  return rounds.map((round, index) => {
    if (index === latestAt && verdict !== undefined) {
      return { ...round, outcome: verdict.outcome };
    }

    return index === last &&
      landed !== undefined &&
      !Outcome.isAnyOf(["Refused"])(round.outcome)
      ? { ...round, outcome: Outcome.cases.Landed.make({ sha: landed.sha }) }
      : round;
  });
};
