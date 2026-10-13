import { Client } from "@repo/protocol/contracts";
import type { CommitView, Rev } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

/**
 * The commit a revision points at, for the Code tab's bar: one read beside
 * the page's own, never per row. It is only a fact over the page, so a page
 * goes without it when it cannot be read.
 */
export const readHead = (
  project: ProjectName,
  rev: Rev
): Effect.Effect<Option.Option<CommitView>, never, Client> =>
  Effect.gen(function* () {
    const client = yield* Client;

    const page = yield* client
      .log({ at: rev, limit: 1, project })
      .pipe(Effect.option);

    return Option.flatMap(page, ({ commits }) =>
      Option.fromUndefinedOr(commits[0])
    );
  });

/** The head as a page's data carries it: present, or no key at all. */
export const headField = (head: Option.Option<CommitView>) =>
  Option.match(head, {
    onNone: () => ({}),
    onSome: (commit) => ({ head: commit }),
  });
