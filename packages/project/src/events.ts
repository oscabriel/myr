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

export type ProjectEventInput = OmitEach<Event, "seq">;

export const ProjectEventInput = Data.taggedEnum<ProjectEventInput>();

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

export const askOpened = (ask: Ask, at: DateTime.Utc): ProjectEventInput =>
  ProjectEventInput.AskOpened({ ask: listingOf(ask), at });

export const askClosed = (
  ask: AskId,
  landing: LandedSha,
  at: DateTime.Utc
): ProjectEventInput => ProjectEventInput.AskClosed({ ask, at, landing });

export const judged = (
  ask: AskId,
  head: CommitSha,
  outcome: Outcome,
  at: DateTime.Utc
): ProjectEventInput => ProjectEventInput.Judged({ ask, at, head, outcome });

const asEvent = Schema.decodeUnknownEffect(Schema.toType(ProjectEvent));

/**
 * The service commits under the project's lock, so nothing numbers an event in
 * between.
 */
export const numbered = (
  lastSeq: number,
  events: readonly ProjectEventInput[]
): Effect.Effect<readonly ProjectEvent[]> =>
  Effect.forEach(events, (event, index) =>
    Effect.orDie(asEvent({ ...event, seq: lastSeq + index + 1 }))
  );
