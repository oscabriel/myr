/**
 * What a decision's page reads, in a module with no view of its own: a
 * route's loader runs before its page's view loads, so the route reaches
 * these without carrying the page.
 *
 * The decision comes from the reader's Today in its project alone, read
 * with their own session: someone who decides nothing there gets why, and
 * no evidence. Beside it, what it concerns, each read on its own (one that
 * fails is left out): the ask, the proposal, the project's posture; for a
 * finish, the verdict on its head and, from the project's events, where
 * the answer's earlier rounds were refused and whether a newer head came.
 */
import { Client } from "@repo/protocol/contracts";
import { Verdict } from "@repo/protocol/domain/answer";
import { Ask } from "@repo/protocol/domain/ask";
import { Decision, DecisionSubject } from "@repo/protocol/domain/decision";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import { Proposal } from "@repo/protocol/domain/proposal";
import { CommitSha, DecisionId, ProjectName } from "@repo/protocol/ids";
import type { AskId } from "@repo/protocol/ids";
import { Posture } from "@repo/protocol/posture";
import { Refusal } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import { DateTime, Effect, Exit, Option, Schema, Stream } from "effect";

import { askStates } from "../shared/ask-progress.ts";
import { findDecision, readOfCause, TodayRead } from "../today/read.ts";

/** A refusal from an answer's round that points at a line, as the page's loader sends it. */
export const Placed = Schema.Struct({
  line: Schema.Int,
  path: Schema.String,
  refusal: Refusal,
  round: Schema.Int,
});

/** What the page read for its reader: the decision and what it concerns, or why there is none. */
export const DecisionRead = Schema.TaggedUnion({
  Found: {
    /** The ask it concerns, when it concerns one. */
    ask: Schema.optionalKey(Ask),
    decision: Decision,
    /** A head pushed to the answer after the one a finish names. */
    newerHead: Schema.optionalKey(CommitSha),
    /** Refusals from the answer's rounds that point at a line. */
    placed: Schema.Array(Placed),
    /** The project's posture, for a posture change. */
    posture: Schema.optionalKey(
      Schema.Struct({ label: Schema.String, posture: Posture })
    ),
    /** The proposal it would open, for an `OpenProposal`. */
    proposal: Schema.optionalKey(Proposal),
    soon: Schema.Boolean,
    /** The verdict on a finish's head. */
    verdict: Schema.optionalKey(Verdict),
  },
  NotOnToday: {},
  Refused: { refusal: Refusal },
  SignedOut: {},
  Unreachable: {},
});

export type DecisionRead = typeof DecisionRead.Type;

export type FoundDecision = Extract<DecisionRead, { readonly _tag: "Found" }>;

/** What a decision's loader sends: whose page, what it read, and when. */
export const DecisionPageData = Schema.Struct({
  decision: DecisionId,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  read: DecisionRead,
});

export type DecisionPageData = typeof DecisionPageData.Type;

/** The refusals among an outcome, when it refused. */
const refusalsOf = (outcome: Outcome): readonly Refusal[] =>
  Outcome.guards.Refused(outcome) ? outcome.refusals : [];

/** Every refusal of an ask's rounds that points at a line, with the round it came from. */
const placedIn = (events: readonly ProjectEvent[], ask: AskId) =>
  (askStates(events).get(ask)?.rounds ?? []).flatMap(({ outcome }, index) =>
    refusalsOf(outcome).flatMap((refusal) =>
      refusal.at === undefined
        ? []
        : [
            {
              line: refusal.at.line,
              path: refusal.at.path,
              refusal,
              round: index + 1,
            },
          ]
    )
  );

/** The head last pushed to `ask`, when it is not `head`. */
export const newerThan = (
  events: readonly ProjectEvent[],
  ask: AskId,
  head: CommitSha
): CommitSha | undefined => {
  const last = askStates(events).get(ask)?.lastPush?.head;

  return last === undefined || last === head ? undefined : last;
};

/** The ask a subject concerns, when it concerns one. */
const askOf = DecisionSubject.match({
  Finish: ({ ask }) => Option.some(ask),
  OpenProposal: () => Option.none(),
  PostureChange: () => Option.none(),
  ProxyWidened: () => Option.none(),
  RaiseRatchet: ({ ask }) => Option.some(ask),
  SecretInTree: ({ ask }) => Option.some(ask),
  StrayPush: () => Option.none(),
  Vouch: () => Option.none(),
  Waiver: ({ ask }) => Option.some(ask),
});

/** What a decision concerns, each read on its own: one that fails is left out. */
const concerning = (decision: Decision, soon: boolean) =>
  Effect.gen(function* () {
    const client = yield* Client;
    const { project, subject } = decision;

    const ask = yield* Option.match(askOf(subject), {
      onNone: () => Effect.succeedNone,
      onSome: (asked) =>
        client.showAsk({ ask: asked, project }).pipe(
          Effect.map(({ ask: shown }) => Option.some(shown)),
          Effect.orElseSucceed(() => Option.none())
        ),
    });

    const proposal = DecisionSubject.guards.OpenProposal(subject)
      ? yield* client
          .showProposal({ project, proposal: subject.proposal })
          .pipe(
            Effect.map(({ proposal: shown }) => Option.some(shown)),
            Effect.orElseSucceed(() => Option.none())
          )
      : Option.none();

    const posture = DecisionSubject.guards.PostureChange(subject)
      ? yield* client.ledger({ project }).pipe(
          Effect.map((ledger) =>
            Option.some({ label: ledger.postureLabel, posture: ledger.posture })
          ),
          Effect.orElseSucceed(() => Option.none())
        )
      : Option.none();

    const finish = DecisionSubject.guards.Finish(subject)
      ? Option.some(subject)
      : Option.none();

    const verdict = yield* Option.match(finish, {
      onNone: () => Effect.succeedNone,
      onSome: ({ ask: asked, head }) =>
        client.verdict({ ask: asked, head, project }).pipe(
          Effect.map(({ verdict: judged }) => Option.fromUndefinedOr(judged)),
          Effect.orElseSucceed(() => Option.none())
        ),
    });

    // A finish's rounds, from the project's events: where earlier rounds
    // were refused, and whether a newer head was pushed.
    const events = Option.isSome(finish)
      ? yield* Stream.runCollect(client.watch({ project, since: 0 })).pipe(
          Effect.map((all): readonly ProjectEvent[] => all),
          Effect.orElseSucceed((): readonly ProjectEvent[] => [])
        )
      : [];

    return DecisionRead.cases.Found.make({
      decision,
      placed: Option.match(finish, {
        onNone: () => [],
        onSome: ({ ask: asked }) => placedIn(events, asked),
      }),
      soon,
      ...Option.match(ask, {
        onNone: () => ({}),
        onSome: (shown) => ({ ask: shown }),
      }),
      ...Option.match(proposal, {
        onNone: () => ({}),
        onSome: (shown) => ({ proposal: shown }),
      }),
      ...Option.match(posture, {
        onNone: () => ({}),
        onSome: (shown) => ({ posture: shown }),
      }),
      ...Option.match(verdict, {
        onNone: () => ({}),
        onSome: (shown) => ({ verdict: shown }),
      }),
      ...Option.match(finish, {
        onNone: () => ({}),
        onSome: ({ ask: asked, head }) => {
          const newer = newerThan(events, asked, head);

          return newer === undefined ? {} : { newerHead: newer };
        },
      }),
    });
  });

/** The decision for its page, and what it concerns, read with the reader's session. */
export const readDecision = (params: {
  readonly project: string;
  readonly decision: string;
}) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(
      params.project
    ).pipe(Effect.mapError(() => notFound()));

    const id = yield* Schema.decodeEffect(DecisionId)(params.decision).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;
    const now = yield* DateTime.now;
    const today = yield* Effect.exit(client.today({ project }));

    const read = yield* Exit.match(today, {
      onFailure: (cause) =>
        Effect.succeed(
          TodayRead.match(readOfCause(cause), {
            Read: (): DecisionRead => DecisionRead.cases.Unreachable.make({}),
            Refused: ({ refusal }): DecisionRead =>
              DecisionRead.cases.Refused.make({ refusal }),
            SignedOut: (): DecisionRead =>
              DecisionRead.cases.SignedOut.make({}),
            Unreachable: (): DecisionRead =>
              DecisionRead.cases.Unreachable.make({}),
          })
        ),
      onSuccess: (listed) =>
        Option.match(findDecision(listed, project, id), {
          onNone: () => Effect.succeed(DecisionRead.cases.NotOnToday.make({})),
          onSome: ({ decision, soon }) => concerning(decision, soon),
        }),
    });

    return yield* Schema.encodeEffect(DecisionPageData)({
      decision: id,
      now,
      project,
      read,
    });
  });
