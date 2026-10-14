import { Client } from "@repo/protocol/contracts";
import { AnswerView } from "@repo/protocol/domain/answer";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Today } from "@repo/protocol/domain/decision";
import { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { Outcome, StageName } from "@repo/protocol/domain/outcome";
import { Handle } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { NotDecider, Refusal } from "@repo/protocol/refusal";
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

import { isSignedOut } from "./decisions.ts";

const ASKS_SHOWN = 8;

export const WORK_SHOWN = 10;

const AT_ONCE = 4;

/** What the answer's verdict holds, so the strip reads a stage it never needed as not needed, as the answer page does. */
export const WorkHolds = Schema.Struct({
  decided: Schema.Boolean,
  heldBack: Schema.Boolean,
});

export const Work = Schema.Struct({
  answer: Schema.optionalKey(AnswerView),
  claim: ClaimView,
  holds: Schema.optionalKey(WorkHolds),
  /** The gate stage the answer reached, from its verdict; absent while it has none. */
  stage: Schema.optionalKey(StageName),
  want: Schema.optionalKey(Schema.NonEmptyString),
});

export type Work = typeof Work.Type;

export const Decisions = Schema.TaggedUnion({
  Decides: { today: Today },
  NotDecider: {},
  Unreachable: {},
});

export type Decisions = typeof Decisions.Type;

export const Takeable = Schema.TaggedUnion({
  Listed: { asks: Schema.Array(FrontPageEntry) },
  Unreachable: {},
});

export type Takeable = typeof Takeable.Type;

export const InboxRead = Schema.TaggedUnion({
  Read: {
    asks: Takeable,
    decisions: Decisions,
    handle: Handle,
    held: Schema.Int,
    running: Schema.Int,
    work: Schema.Array(Work),
  },
  Refused: { refusal: Refusal },
  SignedOut: {},
  Unreachable: {},
});

export type InboxRead = typeof InboxRead.Type;

export const InboxPageData = Schema.Struct({
  now: Schema.DateTimeUtcFromString,
  read: InboxRead,
});

export type InboxPageData = typeof InboxPageData.Type;

/** The decisions the read carries, when the reader decides somewhere and they came. */
export const todayOf = (read: InboxRead): Option.Option<Today> =>
  InboxRead.match(read, {
    Read: ({ decisions }) =>
      Decisions.match(decisions, {
        Decides: ({ today }) => Option.some(today),
        NotDecider: () => Option.none(),
        Unreachable: () => Option.none(),
      }),
    Refused: () => Option.none(),
    SignedOut: () => Option.none(),
    Unreachable: () => Option.none(),
  });

/** The decisions read again after a choice take the loaded ones' place; the rest stays as it was read. */
export const withToday = (read: InboxRead, today: Today): InboxRead =>
  InboxRead.match(read, {
    Read: (signed) =>
      Option.isSome(todayOf(read))
        ? { ...signed, decisions: Decisions.cases.Decides.make({ today }) }
        : read,
    Refused: () => read,
    SignedOut: () => read,
    Unreachable: () => read,
  });

export const isRunning = (claim: ClaimView) =>
  claim.state === "live" || claim.state === "warned";

const openedOrder = Order.mapInput(
  DateTime.Order,
  (claim: ClaimView) => claim.openedAt
);

const workOrder: Order.Order<ClaimView> = Order.combine(
  Order.mapInput(Order.Boolean, (claim: ClaimView) => !isRunning(claim)),
  Order.flip(openedOrder)
);

const answerOrder = Order.mapInput(
  DateTime.Order,
  (answer: AnswerView) => answer.at
);

const isNotDecider = Schema.is(NotDecider);

const isRefusal = Schema.is(Refusal);

export const askKey = ({ ask, project }: ClaimView) => `${project}/${ask}`;

const sharedAsks = (claims: readonly ClaimView[]) =>
  new Set(
    Object.entries(Arr.groupBy(claims, ({ ask }) => ask)).flatMap(
      ([ask, holding]) =>
        new Set(holding.map(({ project }) => project)).size > 1 ? [ask] : []
    )
  );

const answersIn = (projects: readonly ProjectName[]) =>
  Effect.gen(function* () {
    const client = yield* Client;

    return new Map(
      yield* Effect.forEach(
        projects,
        (project) =>
          client.status({ project }).pipe(
            Effect.map(({ answers }) => [project, answers] as const),
            Effect.orElseSucceed(() => [project, []] as const)
          ),
        { concurrency: AT_ONCE }
      )
    );
  });

const wantsOf = (claims: readonly ClaimView[]) =>
  Effect.gen(function* () {
    const client = yield* Client;
    const asks = Arr.dedupeWith(claims, (a, b) => askKey(a) === askKey(b));

    return new Map(
      yield* Effect.forEach(
        asks,
        (claim) =>
          client.showAsk({ ask: claim.ask, project: claim.project }).pipe(
            Effect.map(({ ask }) => [[askKey(claim), ask.brief.want] as const]),
            Effect.orElseSucceed(() => [])
          ),
        { concurrency: AT_ONCE }
      ).pipe(Effect.map((found) => found.flat()))
    );
  });

const shownOf = (claims: readonly ClaimView[]) =>
  Arr.sort(claims, workOrder).slice(0, WORK_SHOWN);

export const pairWork = ({
  again,
  answers,
  claims,
  wants,
}: {
  readonly claims: readonly ClaimView[];
  readonly answers: readonly AnswerView[];
  readonly again: ReadonlyMap<ProjectName, readonly AnswerView[]>;
  readonly wants: ReadonlyMap<string, string>;
}): readonly Work[] => {
  const shared = sharedAsks(claims);

  const newest = new Map(
    Arr.sort(claims, openedOrder).map(
      (claim) => [askKey(claim), claim] as const
    )
  );

  const answerOf = (claim: ClaimView) => {
    if (newest.get(askKey(claim)) !== claim) {
      return Option.none();
    }

    const [latest] = Arr.sort(
      (shared.has(claim.ask)
        ? (again.get(claim.project) ?? [])
        : answers
      ).filter(({ ask }) => ask === claim.ask),
      Order.flip(answerOrder)
    );

    return Option.fromUndefinedOr(latest);
  };

  return shownOf(claims).map((claim): Work => ({
    claim,
    ...Option.match(answerOf(claim), {
      onNone: () => ({}),
      onSome: (answer) => ({ answer }),
    }),
    ...Option.match(Option.fromUndefinedOr(wants.get(askKey(claim))), {
      onNone: () => ({}),
      onSome: (want) => ({ want }),
    }),
  }));
};

const waitedOnPerson = Outcome.isAnyOf(["AwaitingDecision", "AwaitingFinish"]);

const headKey = (project: ProjectName, { ask, head }: AnswerView) =>
  `${project}/${ask}/${head}`;

/** The heads whose answer waited on a maintainer at some round: a landing after one passed the maintainer stage. */
const waitedHeads = (
  answers: readonly AnswerView[],
  again: ReadonlyMap<ProjectName, readonly AnswerView[]>,
  claims: readonly ClaimView[]
) => {
  const projectOf = new Map(
    claims.map(({ ask, project }) => [ask, project] as const)
  );

  return new Set([
    ...answers.flatMap((answer) => {
      const project = projectOf.get(answer.ask);

      return project !== undefined && waitedOnPerson(answer.outcome)
        ? [headKey(project, answer)]
        : [];
    }),
    ...[...again].flatMap(([project, listed]) =>
      listed.flatMap((answer) =>
        waitedOnPerson(answer.outcome) ? [headKey(project, answer)] : []
      )
    ),
  ]);
};

// A verdict names the stage an answer reached, and what it holds; a check still running names its stage in its outcome.
const stageOf = (waited: ReadonlySet<string>) => (work: Work) =>
  Effect.gen(function* () {
    const client = yield* Client;
    const { answer, claim } = work;

    if (answer === undefined) {
      return work;
    }

    const { verdict } = yield* client
      .verdict({ ask: claim.ask, head: answer.head, project: claim.project })
      .pipe(Effect.orElseSucceed(() => ({ verdict: undefined })));

    const stage = Option.firstSomeOf([
      Option.map(Option.fromUndefinedOr(verdict), ({ stage: at }) => at),
      Outcome.isAnyOf(["Checking"])(answer.outcome)
        ? Option.some(answer.outcome.stage)
        : Option.none(),
    ]);

    const holds =
      verdict === undefined
        ? {}
        : {
            holds: {
              decided:
                waited.has(headKey(claim.project, answer)) ||
                waitedOnPerson(answer.outcome),
              heldBack: verdict.heldBack.length > 0,
            },
          };

    return Option.match(stage, {
      onNone: () => work,
      onSome: (at): Work => ({ ...work, ...holds, stage: at }),
    });
  });

const workOf = (claims: readonly ClaimView[], answers: readonly AnswerView[]) =>
  Effect.gen(function* () {
    const shown = shownOf(claims);
    const shared = sharedAsks(claims);

    const [again, wants] = yield* Effect.all(
      [
        answersIn(
          Arr.dedupe(
            shown.flatMap(({ ask, project }) =>
              shared.has(ask) ? [project] : []
            )
          )
        ),
        wantsOf(shown),
      ],
      { concurrency: "unbounded" }
    );

    return yield* Effect.forEach(
      pairWork({ again, answers, claims, wants }),
      stageOf(waitedHeads(answers, again, claims)),
      { concurrency: AT_ONCE }
    );
  });

const failedRead = (cause: Cause.Cause<unknown>): InboxRead => {
  const error = Cause.findErrorOption(cause);

  if (Option.isSome(error) && isRefusal(error.value)) {
    return InboxRead.cases.Refused.make({ refusal: error.value });
  }

  return isSignedOut(cause)
    ? InboxRead.cases.SignedOut.make({})
    : InboxRead.cases.Unreachable.make({});
};

/** `project` narrows the inbox to one project: its decisions, the reader's claims in it and its asks. */
export const readInbox = ({ project }: { readonly project?: ProjectName }) =>
  Effect.gen(function* () {
    const client = yield* Client;
    const scope = project === undefined ? {} : { project };

    const [status, today, front] = yield* Effect.all(
      [
        Effect.exit(client.status(scope)),
        Effect.exit(client.today(scope)),
        Effect.option(client.frontPage({})),
      ],
      { concurrency: "unbounded" }
    );

    const decisions = Exit.match(today, {
      onFailure: (cause) =>
        Option.exists(Cause.findErrorOption(cause), isNotDecider)
          ? Decisions.cases.NotDecider.make({})
          : Decisions.cases.Unreachable.make({}),
      onSuccess: (read) => Decisions.cases.Decides.make({ today: read }),
    });

    const asks = Option.match(front, {
      onNone: () => Takeable.cases.Unreachable.make({}),
      onSome: ({ entries }) =>
        Takeable.cases.Listed.make({
          asks: entries
            .filter(
              (entry) =>
                entry.takeable &&
                (project === undefined || entry.project === project)
            )
            .slice(0, ASKS_SHOWN),
        }),
    });

    const read = yield* Exit.match(status, {
      onFailure: (cause) => Effect.succeed(failedRead(cause)),
      onSuccess: ({ answers, claims, handle }) =>
        workOf(claims, answers).pipe(
          Effect.map((work) =>
            InboxRead.cases.Read.make({
              asks,
              decisions,
              handle,
              held: claims.length,
              running: claims.filter(isRunning).length,
              work,
            })
          )
        ),
    });

    return yield* Schema.encodeEffect(InboxPageData)({
      now: yield* DateTime.now,
      read,
    });
  });
