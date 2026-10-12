import { Brand } from "@repo/brand";
import { notesRef } from "@repo/git/notes";
import { RefNameText } from "@repo/protocol/domain/common";
import { AskId, CommitSha, ProjectName } from "@repo/protocol/ids";
import { Schema } from "effect";

import { RepoKind } from "../../repo-names.ts";
import { isZero } from "./event.ts";
import type { OnPushEvent } from "./event.ts";

export const IgnoredReason = Schema.Literals([
  "own landing",
  "bookkeeping ref",
  "seen",
  "unknown repo",
  "not main",
  "deleted ref",
]);

export type IgnoredReason = typeof IgnoredReason.Type;

export const PushVerdict = Schema.TaggedUnion({
  ForkPush: { ask: AskId, head: CommitSha, project: ProjectName },
  Ignored: { reason: IgnoredReason },
  Stray: {
    after: CommitSha,
    before: CommitSha,
    project: ProjectName,
    ref: RefNameText,
  },
});

export type PushVerdict = typeof PushVerdict.Type;

export interface PushFacts {
  readonly repo: RepoKind;
  readonly landed: ReadonlySet<CommitSha>;
  readonly seen: boolean;
}

export const mainRef = RefNameText.make("refs/heads/main");

export const isBookkeeping = (ref: string): boolean =>
  ref.startsWith(Brand.refsPrefix) || ref === notesRef;

const ignored = (reason: IgnoredReason): PushVerdict =>
  PushVerdict.cases.Ignored.make({ reason });

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
