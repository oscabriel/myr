import type { Discussion } from "@repo/protocol/domain/discussion";
import type { DiscussionId, ProjectName, ProposalId } from "@repo/protocol/ids";
import type { Person } from "@repo/protocol/principal";
import {
  CapReached,
  Denounced,
  DiscussionClosed,
} from "@repo/protocol/refusal";
import { Array, Data, Option, Result } from "effect";
import type { DateTime } from "effect";

import { ProjectEventInput } from "../events.ts";
import { AttentionEffect } from "./effects.ts";

/** How many discussions one person outside the project's vouches may hold open at once. */
export const DISCUSSIONS_PER_PERSON = 20;

interface Poster {
  readonly denounced: boolean;
  readonly who: Person;
}

export type DiscussionCommand = Data.TaggedEnum<{
  Open: Poster & {
    readonly body: Option.Option<string>;
    readonly capped: boolean;
    readonly id: DiscussionId;
    readonly openCount: number;
    readonly project: ProjectName;
    readonly title: string;
  };
  Reply: Poster & { readonly body: string; readonly discussion: Discussion };
}>;

export const DiscussionCommand = Data.taggedEnum<DiscussionCommand>();

export interface Posted {
  readonly discussion: Discussion;
  readonly effects: readonly AttentionEffect[];
}

export type PostRefusal = Denounced | CapReached | DiscussionClosed;

const posted = (discussion: Discussion, now: DateTime.Utc): Posted => ({
  discussion,
  effects: [
    AttentionEffect.Emit({
      event: ProjectEventInput.DiscussionPosted({
        at: now,
        by: Array.lastNonEmpty(discussion.posts).by,
        discussion: discussion.id,
      }),
    }),
  ],
});

const open = (
  command: Data.TaggedEnum.Value<DiscussionCommand, "Open">,
  now: DateTime.Utc
): Result.Result<Posted, Denounced | CapReached> => {
  if (command.denounced) {
    return Result.fail(new Denounced({}));
  }

  if (command.capped && command.openCount >= DISCUSSIONS_PER_PERSON) {
    return Result.fail(
      new CapReached({ cap: DISCUSSIONS_PER_PERSON, limit: "discussions" })
    );
  }

  const first = {
    at: now,
    body: Option.getOrElse(command.body, () => command.title),
    by: command.who.handle,
  };

  return Result.succeed(
    posted(
      {
        id: command.id,
        openedAt: now,
        opener: command.who.handle,
        posts: [first],
        project: command.project,
        state: "open",
        title: command.title,
      },
      now
    )
  );
};

const reply = (
  command: Data.TaggedEnum.Value<DiscussionCommand, "Reply">,
  now: DateTime.Utc
): Result.Result<Posted, Denounced | DiscussionClosed> => {
  if (command.denounced) {
    return Result.fail(new Denounced({}));
  }

  const { discussion } = command;

  if (discussion.state !== "open") {
    return Result.fail(new DiscussionClosed({ discussion: discussion.id }));
  }

  return Result.succeed(
    posted(
      {
        ...discussion,
        posts: [
          ...discussion.posts,
          { at: now, body: command.body, by: command.who.handle },
        ],
      },
      now
    )
  );
};

/** `transition(state, command, now)`: an open thread takes a post; a closed or proposed one refuses it. */
export const post = (
  command: DiscussionCommand,
  now: DateTime.Utc
): Result.Result<Posted, PostRefusal> =>
  DiscussionCommand.$match(command, {
    Open: (opening) => open(opening, now),
    Reply: (replying) => reply(replying, now),
  });

/** A maintainer's proposal from a thread marks it proposed; only an open thread can be. */
export const promoted = (
  discussion: Discussion,
  proposal: ProposalId
): Result.Result<Discussion, DiscussionClosed> =>
  discussion.state === "open"
    ? Result.succeed({ ...discussion, proposal, state: "proposed" })
    : Result.fail(new DiscussionClosed({ discussion: discussion.id }));
