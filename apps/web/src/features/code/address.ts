/**
 * A code page's address, decoded where it arrives (AGENTS.md principle 2):
 * the project's name, the revision's segment (`rev.ts`) and the repo path
 * after it. Each is none when the address cannot name one, which a page
 * answers with a 404 before it asks the platform anything.
 */
import { NoneOrMore } from "@repo/protocol/domain/common";
import { CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { revOf } from "./rev.ts";

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const decodePath = Schema.decodeUnknownOption(RepoPath);

const decodeSha = Schema.decodeUnknownOption(CommitSha);

export const projectOf = (segment: string) => decodeProject(segment);

/** A revision's segment, decoded; none for one that names no revision. */
export const revisionOf = (segment: string) => revOf(segment);

/** A repo path from the address's rest (a trailing slash dropped); none for the root. */
export const repoPathOf = (rest: string | undefined) =>
  rest === undefined || rest === ""
    ? Option.none()
    : decodePath(rest.replace(/\/+$/u, ""));

/** A commit's id from the address. */
export const commitOf = (segment: string) => decodeSha(segment);

/**
 * Where a page of a list starts, from its search parameter: the router
 * reads `?from=30` as the number 30; anything but a whole number from 0 is
 * none.
 */
export const offsetOf = Schema.decodeUnknownOption(NoneOrMore);
