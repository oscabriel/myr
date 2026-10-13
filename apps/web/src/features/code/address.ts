import { forkAddressOf, ForkPoint, forkRev } from "@repo/protocol/domain/code";
import { NoneOrMore } from "@repo/protocol/domain/common";
import { CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { revOf } from "./rev.ts";

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const decodePath = Schema.decodeUnknownOption(RepoPath);

const decodeSha = Schema.decodeUnknownOption(CommitSha);

export const projectOf = (segment: string) => decodeProject(segment);

export const revisionOf = (segment: string) => revOf(segment);

export const repoPathOf = (rest: string | undefined) =>
  rest === undefined || rest === ""
    ? Option.none()
    : decodePath(rest.replace(/\/+$/u, ""));

/**
 * A commit's page names its id, or its id inside a fork
 * (`@<handle>/<ask>:<sha>`): the fork's address comes back as `at`.
 */
export const commitOf = (
  segment: string
): Option.Option<{
  readonly sha: CommitSha;
  readonly at: Option.Option<string>;
}> =>
  Option.orElse(
    Option.map(decodeSha(segment), (sha) => ({ at: Option.none(), sha })),
    () =>
      Option.flatMap(revOf(segment), (rev) =>
        Option.flatMap(forkAddressOf(rev), (fork) =>
          ForkPoint.$match(fork.point, {
            Branch: () => Option.none(),
            Commit: ({ sha }) =>
              Option.some({ at: Option.some(forkRev(fork)), sha }),
          })
        )
      )
  );

/** The router reads `?from=30` as the number 30. */
export const offsetOf = Schema.decodeUnknownOption(NoneOrMore);
