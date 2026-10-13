import {
  forkAddressOf,
  ForkPoint,
  forkRev,
  Rev,
} from "@repo/protocol/domain/code";
import { sameHandle } from "@repo/protocol/ids";
import type { AskId, Handle } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

/** A tag name may hold `/` and `@`, so it is encoded into one segment. */
export const revSegment = (rev: string): string => encodeURIComponent(rev);

const decodeSegment = Option.liftThrowable(decodeURIComponent);

const asRev = Schema.decodeUnknownOption(Rev);

/** A segment the router already decoded reads as itself. */
export const revOf = (segment: string): Option.Option<string> =>
  Option.flatMap(decodeSegment(segment), asRev);

const FULL_SHA = /^[0-9a-f]{40}$/u;

/** A fork's address reads as its claimant and ask, then a branch or a short commit when it names one. */
export const revLabel = (rev: string) =>
  Option.match(forkAddressOf(rev), {
    onNone: () => (FULL_SHA.test(rev) ? rev.slice(0, 7) : rev),
    onSome: ({ ask, handle, point }) =>
      `${handle}/${ask}${ForkPoint.$match(point, {
        Branch: ({ name }) => (name === "main" ? "" : `:${name}`),
        Commit: ({ sha }) => `:${sha.slice(0, 7)}`,
      })}`,
  });

export const isForkRev = (rev: string) => Option.isSome(forkAddressOf(rev));

/** Whether `rev` reads the fork a claimant holds for an ask, at any branch or commit of it. */
export const readsFork = (
  rev: string,
  fork: { readonly ask: AskId; readonly handle: Handle }
) =>
  Option.exists(
    forkAddressOf(rev),
    ({ ask, handle }) => ask === fork.ask && sameHandle(handle, fork.handle)
  );

/**
 * The revision that pins a commit read at `rev`: the bare commit id, or the
 * same id inside the fork `rev` names, since a fork's commits are read there.
 */
export const pinnedRev = (rev: string, sha: string): string =>
  Option.match(forkAddressOf(rev), {
    onNone: () => sha,
    onSome: (fork) => forkRev(fork, sha),
  });
