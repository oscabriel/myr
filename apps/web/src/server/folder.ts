/**
 * A folder and its README, read on the server: the read both the project's
 * page (its root at main) and a folder's page (`/$project/tree/$rev/$`)
 * render from, so either arrives whole, README included, before the
 * browser runs anything. It lives here, not in `features/code/`, because
 * it calls the contracts and the views there import no transport.
 */
import { Client } from "@repo/protocol/contracts";
import type { FileView, Rev, TreeListing } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { RepoPath } from "@repo/protocol/ids";
import type { Unauthenticated } from "@repo/protocol/principal";
import type {
  UnknownPath,
  UnknownProject,
  UnknownRevision,
} from "@repo/protocol/refusal";
import { Effect, Option } from "effect";
import type { RpcClientError } from "effect/rpc";

/** The name most folders give their README, read beside the folder rather than after it. */
const GUESS = "README.md";

/**
 * The folder `path` (the root when none) of `project` at `rev`, and its
 * README; a README that cannot be read leaves the folder without it, while
 * a folder that cannot be read is the platform's refusal (or the call's
 * own failure: the platform did not answer, or turned the credential
 * away).
 *
 * The folder and a `README.md` in it are read at once, saving a round trip
 * on most pages. The guess stands only when it is the README the folder
 * names, read at the folder's commit (`main` may move between the two
 * reads); otherwise the folder's own README is read at its commit.
 */
export const readFolderWithReadme = (input: {
  readonly path: Option.Option<RepoPath>;
  readonly project: ProjectName;
  readonly rev: Rev;
}): Effect.Effect<
  { readonly listing: TreeListing; readonly readme: Option.Option<FileView> },
  | UnknownProject
  | UnknownRevision
  | UnknownPath
  | RpcClientError.RpcClientError
  | Unauthenticated,
  Client
> =>
  Effect.gen(function* () {
    const { path, project, rev } = input;
    const client = yield* Client;

    const guessed = RepoPath.make(
      Option.match(path, {
        onNone: () => GUESS,
        onSome: (folder) => `${folder}/${GUESS}`,
      })
    );

    const [listing, guess] = yield* Effect.all(
      [
        client.readTree({
          at: rev,
          project,
          ...Option.match(path, {
            onNone: () => ({}),
            onSome: (at) => ({ path: at }),
          }),
        }),
        client
          .readFile({ at: rev, path: guessed, project })
          .pipe(Effect.option),
      ],
      { concurrency: 2 }
    );

    const named = listing.readme;

    if (named === undefined) {
      return { listing, readme: Option.none() };
    }

    const readme =
      Option.isSome(guess) &&
      guess.value.path === named.path &&
      guess.value.at === listing.at
        ? guess
        : yield* client
            .readFile({ at: listing.at, path: named.path, project })
            .pipe(Effect.option);

    return { listing, readme };
  });
