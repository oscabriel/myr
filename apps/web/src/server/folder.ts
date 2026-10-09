/**
 * A folder and its README, read on the server: the read both the project's
 * page (its root at main) and a folder's page (`/$project/tree/$rev/$`)
 * render from, so either arrives whole, README included, before the
 * browser runs anything. It lives here, not in `features/code/`, because
 * it calls the contracts and the views there import no transport.
 */
import { Client } from "@repo/protocol/contracts";
import type { FileView, TreeListing } from "@repo/protocol/domain/code";
import type { ProjectName, RepoPath } from "@repo/protocol/ids";
import type { Unauthenticated } from "@repo/protocol/principal";
import type {
  UnknownPath,
  UnknownProject,
  UnknownRevision,
} from "@repo/protocol/refusal";
import { Effect, Option } from "effect";
import type { RpcClientError } from "effect/rpc";

/**
 * The folder `path` (the root when none) of `project` at `rev`, and its
 * README; a README that cannot be read leaves the folder without it, while
 * a folder that cannot be read is the platform's refusal (or the call's
 * own failure: the platform did not answer, or turned the credential
 * away).
 */
export const readFolderWithReadme = (input: {
  readonly path: Option.Option<RepoPath>;
  readonly project: ProjectName;
  readonly rev: string;
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

    const listing = yield* client.readTree({
      at: rev,
      project,
      ...Option.match(path, {
        onNone: () => ({}),
        onSome: (at) => ({ path: at }),
      }),
    });

    const readme =
      listing.readme === undefined
        ? Option.none()
        : yield* client
            .readFile({ at: listing.at, path: listing.readme.path, project })
            .pipe(Effect.option);

    return { listing, readme };
  });
