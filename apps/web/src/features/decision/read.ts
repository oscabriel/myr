/**
 * Kept apart from the page's view: a route's loader runs before the view loads,
 * so the route reaches this without carrying the page.
 */
import { Client } from "@repo/protocol/contracts";
import { Verdict } from "@repo/protocol/domain/answer";
import { Ask } from "@repo/protocol/domain/ask";
import { Decision, DecisionSubject } from "@repo/protocol/domain/decision";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import { CommitSha, DecisionId, ProjectName } from "@repo/protocol/ids";
import type { AskId } from "@repo/protocol/ids";
import { Posture } from "@repo/protocol/posture";
import { Refusal } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import { DateTime, Effect, Exit, Option, Schema, Stream } from "effect";

import { findDecision, readOfCause, TodayRead } from "../inbox/decisions.ts";
import { askStates } from "../shared/ask-progress.ts";

export const Placed = Schema.Struct({
  line: Schema.Int,
  path: Schema.String,
  refusal: Refusal,
  round: Schema.Int,
});

export const DecisionRead = Schema.TaggedUnion({
  Found: {
    ask: Schema.optionalKey(Ask),
    decision: Decision,
    newerHead: Schema.optionalKey(CommitSha),
    placed: Schema.Array(Placed),
    posture: Schema.optionalKey(
      Schema.Struct({ label: Schema.String, posture: Posture })
    ),
    soon: Schema.Boolean,
    verdict: Schema.optionalKey(Verdict),
  },
  NotOnToday: {},
  Refused: { refusal: Refusal },
  SignedOut: {},
  Unreachable: {},
});

export type DecisionRead = typeof DecisionRead.Type;

export type FoundDecision = Extract<DecisionRead, { readonly _tag: "Found" }>;

export const DecisionPageData = Schema.Struct({
  decision: DecisionId,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  read: DecisionRead,
});

export type DecisionPageData = typeof DecisionPageData.Type;

const refusalsOf = (outcome: Outcome): readonly Refusal[] =>
  Outcome.guards.Refused(outcome) ? outcome.refusals : [];

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

export const newerThan = (
  events: readonly ProjectEvent[],
  ask: AskId,
  head: CommitSha
): CommitSha | undefined => {
  const last = askStates(events).get(ask)?.lastPush?.head;

  return last === undefined || last === head ? undefined : last;
};

const askOf = DecisionSubject.match({
  Finish: ({ ask }) => Option.some(ask),
  PostureChange: () => Option.none(),
  ProxyWidened: () => Option.none(),
  RaiseRatchet: ({ ask }) => Option.some(ask),
  SecretInTree: ({ ask }) => Option.some(ask),
  StrayPush: () => Option.none(),
  Vouch: () => Option.none(),
  Waiver: ({ ask }) => Option.some(ask),
});

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
