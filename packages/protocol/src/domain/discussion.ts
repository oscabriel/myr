import { Array, Schema } from "effect";

import { AskId, DiscussionId, Handle, ProjectName } from "../ids.ts";
import { NoneOrMore } from "./common.ts";

export const DiscussionState = Schema.Literals(["open", "closed", "asked"]);

export type DiscussionState = typeof DiscussionState.Type;

export const DiscussionTitle = Schema.NonEmptyString.check(
  Schema.isMaxLength(200)
);

export const PostBody = Schema.NonEmptyString.check(Schema.isMaxLength(10_000));

export const DiscussionPost = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  body: PostBody,
  by: Handle,
});

export type DiscussionPost = typeof DiscussionPost.Type;

/** A thread: its first post is the opener's, and `ask` names the ask a maintainer opened from it. */
export const Discussion = Schema.Struct({
  ask: Schema.optionalKey(AskId),
  id: DiscussionId,
  openedAt: Schema.DateTimeUtcFromString,
  opener: Handle,
  posts: Schema.NonEmptyArray(DiscussionPost),
  project: ProjectName,
  state: DiscussionState,
  title: DiscussionTitle,
});

export type Discussion = typeof Discussion.Type;

/** A thread in a list: its posts counted, not carried. */
export const DiscussionListing = Schema.Struct({
  ask: Schema.optionalKey(AskId),
  id: DiscussionId,
  lastPostAt: Schema.DateTimeUtcFromString,
  openedAt: Schema.DateTimeUtcFromString,
  opener: Handle,
  posts: NoneOrMore,
  project: ProjectName,
  state: DiscussionState,
  title: DiscussionTitle,
});

export type DiscussionListing = typeof DiscussionListing.Type;

export const listingOf = (discussion: Discussion): DiscussionListing => {
  const listing = {
    id: discussion.id,
    lastPostAt: Array.lastNonEmpty(discussion.posts).at,
    openedAt: discussion.openedAt,
    opener: discussion.opener,
    posts: discussion.posts.length,
    project: discussion.project,
    state: discussion.state,
    title: discussion.title,
  };

  return discussion.ask === undefined
    ? listing
    : { ...listing, ask: discussion.ask };
};
