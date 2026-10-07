/**
 * A project's events (`ProjectEvent`): what the service says happened, in
 * the order its store numbers them. Events are written in the same commit as
 * the rows that made them, and each one also goes to the projection through
 * the outbox, so the front page hears every one.
 */
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import type { ProjectEvent as Event } from "@repo/protocol/domain/event";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { Outcome } from "@repo/protocol/domain/outcome";
import type { AskId, CommitSha, LandedSha } from "@repo/protocol/ids";
import { Data, Effect, Schema } from "effect";
import type { DateTime } from "effect";

/** Drops a key from each member of a union, not from the union as a whole. */
type OmitEach<Union, Key extends PropertyKey> = Union extends unknown
  ? Omit<Union, Key>
  : never;

/**
 * A project event before the store numbers it: every `ProjectEvent` but its
 * `seq`, which the store assigns at commit. The one type the lifecycles,
 * attention, the service and the store all write events as.
 */
export type ProjectEventInput = OmitEach<Event, "seq">;

/** Constructors and matchers for project events before the store numbers them. */
export const ProjectEventInput = Data.taggedEnum<ProjectEventInput>();

/** An ask as `listAsks`, the front page and `AskOpened` show it. */
export const listingOf = (ask: Ask): AskListing => {
  const listing = {
    ask: ask.id,
    blockedBy: ask.blockedBy,
    claimed: ask.state === "claimed",
    kind: ask.kind,
    territory: ask.territory.module,
    want: ask.brief.want,
  };

  return ask.reserve === undefined
    ? listing
    : { ...listing, reserve: ask.reserve };
};

/** An ask opened. */
export const askOpened = (ask: Ask, at: DateTime.Utc): ProjectEventInput =>
  ProjectEventInput.AskOpened({ ask: listingOf(ask), at });

/** An answer's landing closed its ask. */
export const askClosed = (
  ask: AskId,
  landing: LandedSha,
  at: DateTime.Utc
): ProjectEventInput => ProjectEventInput.AskClosed({ ask, at, landing });

/** An answer was judged: its checks or its merge decided where it stands. */
export const judged = (
  ask: AskId,
  head: CommitSha,
  outcome: Outcome,
  at: DateTime.Utc
): ProjectEventInput => ProjectEventInput.Judged({ ask, at, head, outcome });

const asEvent = Schema.decodeUnknownEffect(Schema.toType(ProjectEvent));

/**
 * The events as the store will number them when the same commit writes
 * them: on from `lastSeq`, in order. The service commits under the
 * project's lock, so nothing numbers an event in between.
 */
export const numbered = (
  lastSeq: number,
  events: readonly ProjectEventInput[]
): Effect.Effect<readonly ProjectEvent[]> =>
  Effect.forEach(events, (event, index) =>
    Effect.orDie(asEvent({ ...event, seq: lastSeq + index + 1 }))
  );
