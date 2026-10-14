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

const askOf = (event: ProjectEvent): readonly AskId[] =>
  ProjectEvent.match(event, {
    AskClosed: ({ ask }) => [ask],
    AskOpened: ({ ask }) => [ask.ask],
    Claimed: ({ ask }) => [ask],
    Decided: () => [],
    Judged: ({ ask }) => [ask],
    Landed: () => [],
    Lapsed: ({ ask }) => [ask],
    DiscussionPosted: () => [],
    LedgerAppended: () => [],
    ProposalDrafted: () => [],
    ProposalOpened: () => [],
    Pushed: ({ ask }) => [ask],
    Released: ({ ask }) => [ask],
    Warned: ({ ask }) => [ask],
  });

export const eventsAbout = (
  events: readonly ProjectEvent[],
  asks: ReadonlySet<AskId>
): readonly ProjectEvent[] =>
  events.filter((event) => askOf(event).some((about) => asks.has(about)));

/** The platform names a split's delete child after its parent. */
export const deleteChildOf = (parent: Ask): AskId | undefined =>
  parent.blockedBy.find((child) => child === `${parent.id}-delete`);

export const familyHead = (ask: Ask, parent: Ask | undefined) =>
  parent ?? (deleteChildOf(ask) === undefined ? undefined : ask);

export const asksAround = (
  ask: Ask,
  parent: Ask | undefined
): ReadonlySet<AskId> =>
  new Set([
    ask.id,
    ...ask.blockedBy,
    ...(parent === undefined ? [] : [parent.id, ...parent.blockedBy]),
  ]);

export const readEvents = (project: ProjectName) =>
  Effect.gen(function* () {
    const client = yield* Client;

    const events: readonly ProjectEvent[] = yield* Stream.runCollect(
      client.watch({ project, since: 0 })
    ).pipe(Effect.orElseSucceed((): readonly ProjectEvent[] => []));

    return events;
  });

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

export const keptEvents = (
  events: readonly ProjectEvent[],
  ask: Ask,
  parent: Ask | undefined
) => ({
  events: eventsAbout(events, asksAround(ask, parent)),
  lastSeq: lastSeq(events),
});

const waitedOnPerson = Outcome.isAnyOf(["AwaitingDecision", "AwaitingFinish"]);

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

export const roundOf = (
  rounds: readonly Round[],
  head: CommitSha
): { readonly number: number; readonly of: number } | undefined => {
  const index = rounds.findLastIndex((round) => round.head === head);

  return index === -1 ? undefined : { number: index + 1, of: rounds.length };
};

/**
 * A round's own event says what the gate said when it judged the push (often
 * still checking), so the verdict on that head, and the landing that closed the
 * ask, speak for it once they came.
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
