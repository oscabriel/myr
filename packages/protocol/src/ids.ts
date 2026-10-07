import { Schema } from "effect";

/**
 * An ask's name. Lowercase letters, digits and dashes, so a command that names
 * it (`<cli> claim <ask>`) is safe to paste into a shell.
 */
export const AskId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u)),
  Schema.brand("AskId")
);

export type AskId = typeof AskId.Type;

/** A git commit id: 40 lowercase hex digits, git's SHA-1 object format. */
export const CommitSha = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  Schema.brand("CommitSha")
);

export type CommitSha = typeof CommitSha.Type;

/** A path inside a repo, as git prints it. */
export const RepoPath = Schema.NonEmptyString.pipe(Schema.brand("RepoPath"));

export type RepoPath = typeof RepoPath.Type;

/**
 * A project's name. Lowercase letters, digits and dashes, like an ask's, so a
 * command that names it is safe to paste into a shell.
 */
export const ProjectName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u)),
  Schema.brand("ProjectName")
);

export type ProjectName = typeof ProjectName.Type;
