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

export const commitOf = (segment: string) => decodeSha(segment);

/** The router reads `?from=30` as the number 30. */
export const offsetOf = Schema.decodeUnknownOption(NoneOrMore);
