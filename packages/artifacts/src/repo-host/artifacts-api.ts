/**
 * What the two adapters over Artifacts share, the Workers binding's
 * (`binding.ts`) and the REST API's (`rest.ts`): Artifacts' error codes and
 * their numbers, the codes an import refuses a source with, how a revision
 * is named, and the limits on a token's ttl and a log page. One table each,
 * so the two adapters can't drift apart.
 */
import { Duration, Schema } from "effect";

import { Revision } from "../repo-host.ts";

/** Artifacts' names for its errors: `ArtifactsError.code` on the binding. */
export const Code = Schema.Literals([
  "ALREADY_EXISTS",
  "NOT_FOUND",
  "CREATE_IN_PROGRESS",
  "IMPORT_IN_PROGRESS",
  "FORK_IN_PROGRESS",
  "INVALID_INPUT",
  "INVALID_REPO_NAME",
  "INVALID_TTL",
  "INVALID_URL",
  "REMOTE_AUTH_REQUIRED",
  "UPSTREAM_UNAVAILABLE",
  "MEMORY_LIMIT",
  "INTERNAL_ERROR",
]);

export type Code = typeof Code.Type;

export const isCode = Schema.is(Code);

/**
 * Each code by its number, from Artifacts' errors page: the REST API's
 * `errors[].code`, and the binding's `numericCode`. The page gives
 * `CREATE_IN_PROGRESS` no number.
 */
export const NUMBERED: ReadonlyMap<number, Code> = new Map<number, Code>([
  [10_100, "INVALID_INPUT"],
  [10_101, "INVALID_REPO_NAME"],
  [10_103, "INVALID_TTL"],
  [10_104, "INVALID_URL"],
  [10_106, "REMOTE_AUTH_REQUIRED"],
  [10_200, "NOT_FOUND"],
  [10_201, "ALREADY_EXISTS"],
  [10_302, "IMPORT_IN_PROGRESS"],
  [10_303, "FORK_IN_PROGRESS"],
  [10_400, "INTERNAL_ERROR"],
  [10_401, "UPSTREAM_UNAVAILABLE"],
  [10_402, "MEMORY_LIMIT"],
]);

/**
 * The codes an import refuses its source with, as no repo to take: not git,
 * not public, not reachable, or too big.
 */
export const NO_SOURCE = [
  "INVALID_INPUT",
  "INVALID_URL",
  "MEMORY_LIMIT",
  "NOT_FOUND",
  "REMOTE_AUTH_REQUIRED",
  "UPSTREAM_UNAVAILABLE",
] as const satisfies readonly Code[];

/** Artifacts' name for a revision: a short branch name or a commit id, never `refs/…`. */
export const refOf = (at: Revision) =>
  Revision.$match(at, {
    Branch: ({ name }) => name,
    Commit: ({ sha }) => sha,
  });

// Artifacts takes a token's ttl in whole seconds, from a minute to a year.
const MIN_TTL_SECONDS = 60;

const MAX_TTL_SECONDS = 31_536_000;

/** A token's ttl as Artifacts takes it: whole seconds, clamped to a minute and a year. */
export const secondsOf = (ttl: Duration.Duration) =>
  Math.min(
    Math.max(Math.ceil(Duration.toSeconds(ttl)), MIN_TTL_SECONDS),
    MAX_TTL_SECONDS
  );

/** `log` reads at most this many commits per call. */
export const LOG_PAGE = 1000;
