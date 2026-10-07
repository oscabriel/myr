/**
 * What one push event means to the platform (spec §5 step 9), as a pure
 * function of the event and what the project's Durable Object says about it.
 * Pushes the platform made (landings, the landed mirror, parked composes,
 * verdict notes) and claim-fork pushes the gateway already recorded are
 * ignored; a claim-fork push the gateway never saw keeps its claim alive;
 * canonical `main` moved any other way is stray, for the deciders to adopt
 * or revert (CM §4).
 */
import { Brand } from "@repo/brand";
import { notesRef } from "@repo/git/notes";
import { RefNameText } from "@repo/protocol/domain/common";
import { AskId, CommitSha, ProjectName } from "@repo/protocol/ids";
import { Schema } from "effect";

import { RepoKind } from "../../repo-names.ts";
import { isZero } from "./event.ts";
import type { OnPushEvent } from "./event.ts";

/** Why a push needs nothing from the platform. */
export const IgnoredReason = Schema.Literals([
  /** Canonical `main` moved to a commit the platform landed. */
  "own landing",
  /** A ref the platform writes beside `main`: under its prefix, or its notes. */
  "bookkeeping ref",
  /** A claim-fork push the gateway recorded when it forwarded it. */
  "seen",
  /** A repo no project of the platform's has. */
  "unknown repo",
  /** A ref whose moves the platform does not track: a canonical branch other than `main`, or a decider's working fork. */
  "not main",
  /** A claim fork's ref deleted: no commit to keep the claim alive with. */
  "deleted ref",
]);

export type IgnoredReason = typeof IgnoredReason.Type;

/** What the platform does about one push event. */
export const PushVerdict = Schema.TaggedUnion({
  /** A claim-fork push the gateway never recorded: record it, for its claim's liveness. */
  ForkPush: { ask: AskId, head: CommitSha, project: ProjectName },
  Ignored: { reason: IgnoredReason },
  /**
   * Canonical `main` moved without a landing: a `StrayPush` decision whose
   * default is revert. `after` is git's zero id when `main` was deleted,
   * `before` when it was created.
   */
  Stray: {
    after: CommitSha,
    before: CommitSha,
    project: ProjectName,
    ref: RefNameText,
  },
});

export type PushVerdict = typeof PushVerdict.Type;

/** What the project's Durable Object says about a push event, read before it is classified. */
export interface PushFacts {
  /** The repo, by its name; `Unknown` also when no project has that name. */
  readonly repo: RepoKind;
  /** Commits the platform landed on canonical `main`, among those the event names. */
  readonly landed: ReadonlySet<CommitSha>;
  /** Whether the gateway recorded this repo taking the event's `after`. */
  readonly seen: boolean;
}

/** The one canonical ref the platform alone moves. */
export const mainRef = RefNameText.make("refs/heads/main");

/**
 * A ref the platform writes beside `main`, in its own push after main's
 * (S1 change 1): the landed mirror and parked composes under its prefix,
 * and its verdict notes. Each fires its own event (S1 #13).
 */
export const isBookkeeping = (ref: string): boolean =>
  ref.startsWith(Brand.refsPrefix) || ref === notesRef;

const ignored = (reason: IgnoredReason): PushVerdict =>
  PushVerdict.cases.Ignored.make({ reason });

/** What `event` means, given what the project's Durable Object said of it. */
export const classifyPush = (
  event: OnPushEvent,
  facts: PushFacts
): PushVerdict => {
  const { after, before, ref } = event.payload;

  return RepoKind.$match(facts.repo, {
    Canonical: ({ project }) => {
      if (isBookkeeping(ref)) {
        return ignored("bookkeeping ref");
      }

      if (ref !== mainRef) {
        return ignored("not main");
      }

      return facts.landed.has(after)
        ? ignored("own landing")
        : PushVerdict.cases.Stray.make({
            after,
            before,
            project,
            ref: mainRef,
          });
    },
    ClaimFork: ({ ask, project }) => {
      if (isBookkeeping(ref)) {
        return ignored("bookkeeping ref");
      }

      if (isZero(after)) {
        return ignored("deleted ref");
      }

      return facts.seen
        ? ignored("seen")
        : PushVerdict.cases.ForkPush.make({ ask, head: after, project });
    },
    Unknown: () => ignored("unknown repo"),
    WorkingFork: () =>
      isBookkeeping(ref) ? ignored("bookkeeping ref") : ignored("not main"),
  });
};
