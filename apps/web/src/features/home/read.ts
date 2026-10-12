import { Client } from "@repo/protocol/contracts";
import { AnswerView } from "@repo/protocol/domain/answer";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Today } from "@repo/protocol/domain/decision";
import { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { Handle } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { NotDecider } from "@repo/protocol/refusal";
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

import { isSignedOut } from "../today/read.ts";

const ASKS_SHOWN = 8;

export const WORK_SHOWN = 10;

const AT_ONCE = 4;

export const Work = Schema.Struct({
  answer: Schema.optionalKey(AnswerView),
  claim: ClaimView,
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

export const HomeRead = Schema.TaggedUnion({
  Read: {
    asks: Takeable,
    decisions: Decisions,
    handle: Handle,
    held: Schema.Int,
    running: Schema.Int,
    work: Schema.Array(Work),
  },
  SignedOut: {},
  Unreachable: {},
});

export type HomeRead = typeof HomeRead.Type;

export const HomePageData = Schema.Struct({
  now: Schema.DateTimeUtcFromString,
  read: HomeRead,
});

export type HomePageData = typeof HomePageData.Type;

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

    return pairWork({ again, answers, claims, wants });
  });

export const readHome = Effect.gen(function* () {
  const client = yield* Client;

  const [status, today, front] = yield* Effect.all(
    [
      Effect.exit(client.status({})),
      Effect.exit(client.today({})),
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
        asks: entries.filter(({ takeable }) => takeable).slice(0, ASKS_SHOWN),
      }),
  });

  const read = yield* Exit.match(status, {
    onFailure: (cause) =>
      Effect.succeed(
        isSignedOut(cause)
          ? HomeRead.cases.SignedOut.make({})
          : HomeRead.cases.Unreachable.make({})
      ),
    onSuccess: ({ answers, claims, handle }) =>
      workOf(claims, answers).pipe(
        Effect.map((work) =>
          HomeRead.cases.Read.make({
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

  return yield* Schema.encodeEffect(HomePageData)({
    now: yield* DateTime.now,
    read,
  });
});
