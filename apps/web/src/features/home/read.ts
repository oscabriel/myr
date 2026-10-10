/**
 * What `/home` reads, in a module with no view of its own: a route's loader
 * runs before its page's view loads.
 *
 * - `HomeRead`: the reader's work (each claim from `status`, its ask's want
 *   and its latest answer), their Today when they decide somewhere, the
 *   open asks they may take (`frontPage`, read as them), or why there is
 *   none of it.
 * - `readHome`: that read, made with whatever `Client` the caller gives
 *   (the server's, carrying the reader's own session).
 */
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

/** The asks the page lists: the first few the reader may take; the rest are at `/asks`. */
const ASKS_SHOWN = 8;

/** The claims the page lists, running first, then the newest; the rest are in `status`. */
export const WORK_SHOWN = 10;

/** How many reads of one kind the page makes at once. */
const AT_ONCE = 4;

/** One claim of the reader's, its ask's want, and its latest answer. */
export const Work = Schema.Struct({
  answer: Schema.optionalKey(AnswerView),
  claim: ClaimView,
  /** Absent when the ask did not come: the row names it by its id. */
  want: Schema.optionalKey(Schema.NonEmptyString),
});

export type Work = typeof Work.Type;

/** The decisions block: the reader's Today, or why there is none. */
export const Decisions = Schema.TaggedUnion({
  Decides: { today: Today },
  NotDecider: {},
  Unreachable: {},
});

export type Decisions = typeof Decisions.Type;

/** The asks block: the first the reader may take, or that the list did not come. */
export const Takeable = Schema.TaggedUnion({
  Listed: { asks: Schema.Array(FrontPageEntry) },
  Unreachable: {},
});

export type Takeable = typeof Takeable.Type;

/** What the page read for its reader: their work, or why there is none. */
export const HomeRead = Schema.TaggedUnion({
  Read: {
    asks: Takeable,
    decisions: Decisions,
    handle: Handle,
    /** Every claim the reader holds, of which `work` is the first `WORK_SHOWN`. */
    held: Schema.Int,
    /** How many of those are still running. */
    running: Schema.Int,
    work: Schema.Array(Work),
  },
  SignedOut: {},
  Unreachable: {},
});

export type HomeRead = typeof HomeRead.Type;

/** What the loader sends: the read, and the instant it was made. */
export const HomePageData = Schema.Struct({
  now: Schema.DateTimeUtcFromString,
  read: HomeRead,
});

export type HomePageData = typeof HomePageData.Type;

/** A claim still running: its holder's to push to. */
export const isRunning = (claim: ClaimView) =>
  claim.state === "live" || claim.state === "warned";

const openedOrder = Order.mapInput(
  DateTime.Order,
  (claim: ClaimView) => claim.openedAt
);

/** Running claims first, then the newest. */
const workOrder: Order.Order<ClaimView> = Order.combine(
  Order.mapInput(Order.Boolean, (claim: ClaimView) => !isRunning(claim)),
  Order.flip(openedOrder)
);

const answerOrder = Order.mapInput(
  DateTime.Order,
  (answer: AnswerView) => answer.at
);

const isNotDecider = Schema.is(NotDecider);

/** Where a claim's ask lives: one key per (project, ask). */
export const askKey = ({ ask, project }: ClaimView) => `${project}/${ask}`;

/**
 * The asks whose id the reader's claims hold in more than one project.
 * `status` names an answer's ask but not its project, so those asks' answers
 * are read again one project at a time.
 */
const sharedAsks = (claims: readonly ClaimView[]) =>
  new Set(
    Object.entries(Arr.groupBy(claims, ({ ask }) => ask)).flatMap(
      ([ask, holding]) =>
        new Set(holding.map(({ project }) => project)).size > 1 ? [ask] : []
    )
  );

/** The reader's answers in each of `projects`; a project that did not answer gives none. */
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

/** Each shown claim's ask's want, by `askKey`; an ask that did not come is left out. */
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

/** The claims the page lists: running first, then the newest, the first `WORK_SHOWN`. */
const shownOf = (claims: readonly ClaimView[]) =>
  Arr.sort(claims, workOrder).slice(0, WORK_SHOWN);

/**
 * The reader's first claims, each with its want and its latest answer. An
 * answer belongs to the newest claim on its ask in its project; an older
 * claim on the same ask shows its own state. An ask whose id the reader
 * holds in two projects takes its answers from `again`, read per project.
 */
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

  /** The claim each (project, ask) gives its answer to: the newest, set last. */
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

/** `pairWork` over what the platform answers: the wants, and answers read again where needed. */
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

/** The reader's home, or why there is none, encoded for the page. */
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
