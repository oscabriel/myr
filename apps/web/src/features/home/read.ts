/**
 * What `/home` reads, in a module with no view of its own: a route's loader
 * runs before its page's view loads.
 *
 * - `HomeRead`: the reader's claims and answers (`status`), their Today when
 *   they decide somewhere, the open asks they may take (`frontPage`, read
 *   as them), or why there is none of it.
 * - `readHome`: that read, made with whatever `Client` the caller gives
 *   (the server's, carrying the reader's own session).
 */
import { Client } from "@repo/protocol/contracts";
import { AnswerView } from "@repo/protocol/domain/answer";
import { ClaimView } from "@repo/protocol/domain/claim";
import { Today } from "@repo/protocol/domain/decision";
import { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { Handle } from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import { Cause, DateTime, Effect, Exit, Option, Schema } from "effect";

/** The asks the page lists: the first few the reader may take; the rest are at `/asks`. */
const ASKS_SHOWN = 8;

/** What the page read for its reader: their work, or why there is none. */
export const HomeRead = Schema.TaggedUnion({
  Read: {
    answers: Schema.Array(AnswerView),
    asks: Schema.Array(FrontPageEntry),
    claims: Schema.Array(ClaimView),
    handle: Handle,
    /** Absent for a reader who decides nowhere, or whose Today did not come. */
    today: Schema.optionalKey(Today),
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

const isUnauthenticated = Schema.is(Unauthenticated);

/** A failed `status`, as the page says it: signed out, or the platform did not answer. */
const readOfCause = (cause: Cause.Cause<unknown>): HomeRead =>
  Option.exists(Cause.findErrorOption(cause), isUnauthenticated)
    ? HomeRead.cases.SignedOut.make({})
    : HomeRead.cases.Unreachable.make({});

/** The reader's home, or why there is none, encoded for the page. */
export const readHome = Effect.gen(function* () {
  const client = yield* Client;

  const [status, today, front] = yield* Effect.all(
    [
      Effect.exit(client.status({})),
      // A reader who decides nowhere has no Today: the block is left out.
      Effect.option(client.today({})),
      Effect.option(client.frontPage({})),
    ],
    { concurrency: "unbounded" }
  );

  const read = Exit.match(status, {
    onFailure: readOfCause,
    onSuccess: ({ answers, claims, handle }) =>
      HomeRead.cases.Read.make({
        answers,
        asks: Option.match(front, {
          onNone: () => [],
          onSome: ({ entries }) =>
            entries.filter(({ takeable }) => takeable).slice(0, ASKS_SHOWN),
        }),
        claims,
        handle,
        ...Option.match(today, {
          onNone: () => ({}),
          onSome: (decisions) => ({ today: decisions }),
        }),
      }),
  });

  return yield* Schema.encodeEffect(HomePageData)({
    now: yield* DateTime.now,
    read,
  });
});
